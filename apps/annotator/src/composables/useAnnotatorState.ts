import { computed, ref, watch, type ComponentPublicInstance } from 'vue';
import {
  FilterValidationError,
  buildTimeline,
  normalizeFilters,
  parseFilterFile,
  serializeFilterFile,
  type ProfanityAnalysisProgressEvent,
  type ProfanityAnalysisResult,
  type ProfanitySuggestion,
  type FilterSegment,
  type FilterType,
  type TimelineSegment
} from '@cleanvid/shared';
import type { EditableSegment, SegmentIssue } from '../annotator-types';
import { formatTimestamp } from '../time';

const SEEK_STEP_SECONDS = 5;
const FINE_SEEK_STEP_SECONDS = 0.1;

interface OpenVideoResponse {
  cancelled: boolean;
  inputPath?: string;
  name?: string;
  outputPath?: string;
  playbackUrl?: string;
  playbackSource?: 'original' | 'preview';
}

interface OpenVideoProgressPayload {
  phase: 'select-file' | 'check-format' | 'check-cache' | 'remux' | 'encode' | 'finalize';
  message: string;
  percent?: number;
}

interface OpenVideoProgressStreamEvent {
  type: 'progress';
  progress: OpenVideoProgressPayload;
}

interface OpenVideoResultStreamEvent {
  type: 'result';
  result: OpenVideoResponse;
}

interface OpenVideoErrorStreamEvent {
  type: 'error';
  message: string;
}

type OpenVideoStreamEvent =
  | OpenVideoProgressStreamEvent
  | OpenVideoResultStreamEvent
  | OpenVideoErrorStreamEvent;

interface ProcessResponse {
  outputPath: string;
  filtersPath?: string;
  message: string;
}

interface SelectOutputPathResponse {
  cancelled: boolean;
  outputPath?: string;
}

interface SelectSubtitlePathResponse {
  cancelled: boolean;
  subtitlePath?: string;
}

interface AnalyzeProfanityResultStreamEvent {
  type: 'result';
  result: ProfanityAnalysisResult;
}

interface AnalyzeProfanityProgressStreamEvent {
  type: 'progress';
  progress: ProfanityAnalysisProgressEvent;
}

interface AnalyzeProfanityErrorStreamEvent {
  type: 'error';
  message: string;
}

type AnalyzeProfanityStreamEvent =
  | AnalyzeProfanityProgressStreamEvent
  | AnalyzeProfanityResultStreamEvent
  | AnalyzeProfanityErrorStreamEvent;

interface ProcessProgressPayload {
  phase: 'read-filters' | 'probe-media' | 'plan-timeline' | 'build-graph' | 'encode' | 'done';
  message: string;
  percent?: number;
}

interface ProcessProgressStreamEvent {
  type: 'progress';
  progress: ProcessProgressPayload;
}

interface ProcessResultStreamEvent {
  type: 'result';
  result: ProcessResponse;
}

interface ProcessErrorStreamEvent {
  type: 'error';
  message: string;
}

type ProcessStreamEvent =
  | ProcessProgressStreamEvent
  | ProcessResultStreamEvent
  | ProcessErrorStreamEvent;

function createSegmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `segment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readTextFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Unable to read the selected file.'));
    };

    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };

    reader.readAsText(file);
  });
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.message || 'The request failed.');
  }

  return payload as T;
}

export function useAnnotatorState() {
  const videoElement = ref<HTMLVideoElement | null>(null);
  const videoUrl = ref<string | null>(null);
  const inputPath = ref('');
  const inputName = ref('');
  const outputPath = ref('');
  const playbackSource = ref<'original' | 'preview' | null>(null);
  const movieTitle = ref('');
  const importedMovieDuration = ref(0);
  const currentTime = ref(0);
  const videoDuration = ref(0);
  const isPlaying = ref(false);
  const isOpeningVideo = ref(false);
  const isSelectingOutputPath = ref(false);
  const isSelectingSubtitlePath = ref(false);
  const isAnalyzingProfanity = ref(false);
  const isProcessing = ref(false);
  const openVideoProgressPercent = ref(0);
  const analyzeProfanityProgressPercent = ref(0);
  const processProgressPercent = ref(0);
  const previewPlaybackEnabled = ref(true);
  const previewActiveType = ref<FilterType | null>(null);
  const activeType = ref<FilterType>('mute');
  const pendingStart = ref<number | null>(null);
  const pendingType = ref<FilterType | null>(null);
  const segments = ref<EditableSegment[]>([]);
  const selectedSegmentId = ref<string | null>(null);
  const profanitySuggestions = ref<ProfanitySuggestion[]>([]);
  const profanitySubtitlePath = ref('');
  const statusMessage = ref('Open a video to begin annotating.');
  const errorMessage = ref('');
  const persistedFiltersSignature = ref('[]');
  let previewMutedApplied = false;
  let previewMutedOriginal = false;

  const effectiveDuration = computed(() => videoDuration.value || importedMovieDuration.value || 0);
  const previewTimeline = computed<TimelineSegment[]>(() => {
    if (effectiveDuration.value <= 0) {
      return [];
    }

    const validSegments = segments.value.filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.start >= 0 &&
        segment.end >= 0 &&
        segment.start < segment.end
    );

    return buildTimeline(
      validSegments.map((segment) => ({
        id: segment.id,
        type: segment.type,
        start: segment.start,
        end: segment.end
      })),
      effectiveDuration.value
    );
  });

  function sortSegments(items: EditableSegment[]): EditableSegment[] {
    return [...items].sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.type.localeCompare(right.type) ||
        left.id.localeCompare(right.id)
    );
  }

  function serializeSegmentNumber(value: number): number | string {
    if (Number.isNaN(value)) {
      return 'NaN';
    }

    if (value === Number.POSITIVE_INFINITY) {
      return 'Infinity';
    }

    if (value === Number.NEGATIVE_INFINITY) {
      return '-Infinity';
    }

    if (Object.is(value, -0)) {
      return '-0';
    }

    return value;
  }

  function createFiltersSignature(items: EditableSegment[]): string {
    return JSON.stringify(
      sortSegments(items).map((segment) => ({
        id: segment.id,
        type: segment.type,
        start: serializeSegmentNumber(segment.start),
        end: serializeSegmentNumber(segment.end)
      }))
    );
  }

  function markFiltersPersisted(items: EditableSegment[] = segments.value) {
    persistedFiltersSignature.value = createFiltersSignature(items);
  }

  function getSegmentIssues(segment: EditableSegment): string[] {
    const issues: string[] = [];
    const duration = effectiveDuration.value;

    if (!Number.isFinite(segment.start)) {
      issues.push('Start must be a number.');
    }

    if (!Number.isFinite(segment.end)) {
      issues.push('End must be a number.');
    }

    if (Number.isFinite(segment.start) && segment.start < 0) {
      issues.push('Start must be zero or greater.');
    }

    if (Number.isFinite(segment.end) && segment.end < 0) {
      issues.push('End must be zero or greater.');
    }

    if (Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start >= segment.end) {
      issues.push('Start must be less than end.');
    }

    if (duration > 0 && Number.isFinite(segment.start) && segment.start > duration) {
      issues.push('Start exceeds the video duration.');
    }

    if (duration > 0 && Number.isFinite(segment.end) && segment.end > duration) {
      issues.push('End exceeds the video duration.');
    }

    return issues;
  }

  const segmentIssues = computed<SegmentIssue[]>(() =>
    sortSegments(segments.value)
      .map((segment) => ({
        id: segment.id,
        messages: getSegmentIssues(segment)
      }))
      .filter((issue) => issue.messages.length > 0)
  );

  const canMark = computed(() => videoElement.value !== null && effectiveDuration.value > 0);
  const canExport = computed(() => effectiveDuration.value > 0 && segmentIssues.value.length === 0);
  const canAnalyzeProfanity = computed(
    () => inputPath.value !== '' && !isOpeningVideo.value && !isAnalyzingProfanity.value && !isProcessing.value
  );
  const canProcessVideo = computed(
    () =>
      inputPath.value !== '' &&
      segmentIssues.value.length === 0 &&
      !isProcessing.value &&
      !isOpeningVideo.value
  );
  const sortedSegments = computed(() => sortSegments(segments.value));
  const hasUnexportedFilters = computed(
    () => inputPath.value !== '' && createFiltersSignature(segments.value) !== persistedFiltersSignature.value
  );
  const activeTypeLabel = computed(() => (activeType.value === 'mute' ? 'Mute' : 'Skip'));
  const pendingTypeLabel = computed(() =>
    pendingType.value === null ? '' : pendingType.value === 'mute' ? 'Mute' : 'Skip'
  );
  const playbackSourceLabel = computed(() =>
    playbackSource.value === 'preview'
      ? 'Generated MP4 preview'
      : playbackSource.value === 'original'
        ? 'Original file'
        : ''
  );
  const markerCountLabel = computed(
    () => `${sortedSegments.value.length} marker${sortedSegments.value.length === 1 ? '' : 's'}`
  );
  const profanitySuggestionCountLabel = computed(
    () =>
      `${profanitySuggestions.value.length} suggestion${
        profanitySuggestions.value.length === 1 ? '' : 's'
      }`
  );

  function clearFeedback() {
    errorMessage.value = '';
  }

  function getDisplayProcessPercent(progress: ProcessProgressPayload): number {
    const phasePercents: Record<ProcessProgressPayload['phase'], number> = {
      'read-filters': 6,
      'probe-media': 12,
      'plan-timeline': 22,
      'build-graph': 32,
      'encode': 35,
      'done': 100
    };

    if (progress.phase === 'encode') {
      const encodePercent = Number.isFinite(progress.percent) ? progress.percent ?? 0 : 0;
      return Math.max(35, Math.min(99, Math.round(35 + encodePercent * 64)));
    }

    return phasePercents[progress.phase];
  }

  async function requestOpenVideoWithProgress(): Promise<OpenVideoResponse> {
    const response = await fetch('/api/open-video', {
      headers: {
        Accept: 'application/x-ndjson'
      }
    });

    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.includes('application/x-ndjson') || !response.body) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message || 'The request failed.');
      }

      return payload as OpenVideoResponse;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: OpenVideoResponse | null = null;

    const handleEvent = (event: OpenVideoStreamEvent) => {
      if (event.type === 'progress') {
        openVideoProgressPercent.value = Math.max(
          openVideoProgressPercent.value,
          Math.max(0, Math.min(99, Math.round(event.progress.percent ?? 0)))
        );
        statusMessage.value = event.progress.message;
        return;
      }

      if (event.type === 'result') {
        openVideoProgressPercent.value = 100;
        result = event.result;
        return;
      }

      throw new Error(event.message);
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line !== '') {
          handleEvent(JSON.parse(line) as OpenVideoStreamEvent);
        }

        newlineIndex = buffer.indexOf('\n');
      }

      if (done) {
        break;
      }
    }

    const trailingLine = buffer.trim();

    if (trailingLine !== '') {
      handleEvent(JSON.parse(trailingLine) as OpenVideoStreamEvent);
    }

    if (result) {
      return result;
    }

    throw new Error('Open-video stream ended unexpectedly.');
  }

  async function requestProcessWithProgress(body: Record<string, unknown>): Promise<ProcessResponse> {
    const response = await fetch('/api/process', {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.includes('application/x-ndjson') || !response.body) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message || 'The request failed.');
      }

      return payload as ProcessResponse;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ProcessResponse | null = null;

    const handleEvent = (event: ProcessStreamEvent) => {
      if (event.type === 'progress') {
        processProgressPercent.value = Math.max(
          processProgressPercent.value,
          getDisplayProcessPercent(event.progress)
        );
        statusMessage.value = event.progress.message;
        return;
      }

      if (event.type === 'result') {
        processProgressPercent.value = 100;
        result = event.result;
        return;
      }

      throw new Error(event.message);
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line !== '') {
          handleEvent(JSON.parse(line) as ProcessStreamEvent);
        }

        newlineIndex = buffer.indexOf('\n');
      }

      if (done) {
        break;
      }
    }

    const trailingLine = buffer.trim();

    if (trailingLine !== '') {
      handleEvent(JSON.parse(trailingLine) as ProcessStreamEvent);
    }

    if (result) {
      return result;
    }

    throw new Error('Processing stream ended unexpectedly.');
  }

  async function requestAnalyzeProfanityWithProgress(
    body: Record<string, unknown>
  ): Promise<ProfanityAnalysisResult> {
    const response = await fetch('/api/analyze-profanity', {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.includes('application/x-ndjson') || !response.body) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message || 'The request failed.');
      }

      return payload as ProfanityAnalysisResult;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ProfanityAnalysisResult | null = null;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line !== '') {
          const event = JSON.parse(line) as AnalyzeProfanityStreamEvent;

          if (event.type === 'progress') {
            analyzeProfanityProgressPercent.value = Math.max(
              analyzeProfanityProgressPercent.value,
              event.progress.percent ?? 0
            );
            statusMessage.value = event.progress.message;
          } else if (event.type === 'result') {
            analyzeProfanityProgressPercent.value = 100;
            result = event.result;
          } else {
            throw new Error(event.message);
          }
        }

        newlineIndex = buffer.indexOf('\n');
      }

      if (done) {
        break;
      }
    }

    const trailingLine = buffer.trim();

    if (trailingLine !== '') {
      const event = JSON.parse(trailingLine) as AnalyzeProfanityStreamEvent;

      if (event.type === 'progress') {
        analyzeProfanityProgressPercent.value = Math.max(
          analyzeProfanityProgressPercent.value,
          event.progress.percent ?? 0
        );
        statusMessage.value = event.progress.message;
      } else if (event.type === 'result') {
        analyzeProfanityProgressPercent.value = 100;
        result = event.result;
      } else {
        throw new Error(event.message);
      }
    }

    if (result) {
      return result;
    }

    throw new Error('Analysis stream ended unexpectedly.');
  }

  function setError(message: string) {
    errorMessage.value = message;
  }

  function clampToDuration(value: number): number {
    const duration = effectiveDuration.value;

    if (!Number.isFinite(value)) {
      return value;
    }

    if (duration <= 0) {
      return Math.max(0, value);
    }

    return Math.max(0, Math.min(value, duration));
  }

  function syncVideoState() {
    if (!videoElement.value) {
      currentTime.value = 0;
      isPlaying.value = false;
      return;
    }

    currentTime.value = videoElement.value.currentTime;
    isPlaying.value = !videoElement.value.paused;
  }

  function clearPreviewMute() {
    if (!videoElement.value || !previewMutedApplied) {
      previewMutedApplied = false;
      return;
    }

    videoElement.value.muted = previewMutedOriginal;
    previewMutedApplied = false;
  }

  function clearPreviewEffects() {
    previewActiveType.value = null;
    clearPreviewMute();
  }

  function clearProfanitySuggestions() {
    profanitySuggestions.value = [];
    analyzeProfanityProgressPercent.value = 0;
  }

  function clearFiltersForNextVideo() {
    segments.value = [];
    selectedSegmentId.value = null;
    importedMovieDuration.value = 0;
    markFiltersPersisted([]);
    clearProfanitySuggestions();
    profanitySubtitlePath.value = '';
  }

  function applyPreviewPlayback() {
    const video = videoElement.value;

    if (!video || !previewPlaybackEnabled.value || !isPlaying.value) {
      clearPreviewEffects();
      return;
    }

    const activeSegment = previewTimeline.value.find(
      (segment) => segment.kind !== 'keep' && currentTime.value >= segment.start && currentTime.value < segment.end
    );

    if (!activeSegment) {
      clearPreviewEffects();
      return;
    }

    if (activeSegment.kind === 'skip') {
      previewActiveType.value = 'skip';
      clearPreviewMute();
      seekTo(activeSegment.end);
      return;
    }

    previewActiveType.value = 'mute';

    if (!previewMutedApplied) {
      previewMutedOriginal = video.muted;
      previewMutedApplied = true;
    }

    video.muted = true;
  }

  function revokeVideoUrl() {
    if (videoUrl.value?.startsWith('blob:')) {
      URL.revokeObjectURL(videoUrl.value);
    }

    videoUrl.value = null;
  }

  function registerVideoElement(element: Element | ComponentPublicInstance | null) {
    videoElement.value = element instanceof HTMLVideoElement ? element : null;
  }

  function handleLoadedMetadata(video?: HTMLVideoElement | null) {
    if (video) {
      videoElement.value = video;
    }

    videoDuration.value = Number.isFinite(videoElement.value?.duration) ? videoElement.value?.duration ?? 0 : 0;
    statusMessage.value =
      playbackSource.value === 'preview'
        ? 'Preview ready. Playback uses a generated MP4 preview; processing still uses the original file.'
        : 'Video ready. Playback and processing both use the original file.';
    segments.value = segments.value.map((segment) => ({
      ...segment,
      start: clampToDuration(segment.start),
      end: clampToDuration(segment.end)
    }));
    syncVideoState();
    applyPreviewPlayback();
  }

  function handleTimeUpdate(video?: HTMLVideoElement | null) {
    if (video) {
      videoElement.value = video;
    }

    syncVideoState();
    applyPreviewPlayback();
  }

  function handlePlayStateChange(video?: HTMLVideoElement | null) {
    if (video) {
      videoElement.value = video;
    }

    syncVideoState();
    applyPreviewPlayback();
  }

  async function togglePlayback() {
    clearFeedback();

    if (!videoElement.value) {
      return;
    }

    if (videoElement.value.paused) {
      await videoElement.value.play();
    } else {
      videoElement.value.pause();
    }

    syncVideoState();
    applyPreviewPlayback();
  }

  function seekBy(deltaSeconds: number) {
    clearFeedback();

    if (!videoElement.value) {
      return;
    }

    videoElement.value.currentTime = clampToDuration(videoElement.value.currentTime + deltaSeconds);
    syncVideoState();
    applyPreviewPlayback();
  }

  function seekTo(start: number) {
    if (!videoElement.value) {
      return;
    }

    videoElement.value.currentTime = clampToDuration(start);
    syncVideoState();
    applyPreviewPlayback();
  }

  function startMark(type: FilterType) {
    clearFeedback();

    if (!canMark.value || !videoElement.value) {
      setError('Open a video before marking a segment.');
      return;
    }

    activeType.value = type;
    pendingStart.value = clampToDuration(videoElement.value.currentTime);
    pendingType.value = type;
    statusMessage.value = `${type === 'mute' ? 'Mute' : 'Skip'} marking started at ${formatTimestamp(pendingStart.value)}.`;
  }

  function completeMark(type: FilterType) {
    clearFeedback();

    if (!canMark.value || !videoElement.value) {
      setError('Open a video before marking a segment.');
      return;
    }

    if (pendingStart.value === null || pendingType.value !== type) {
      setError(`Start a ${type} mark before closing it.`);
      return;
    }

    const start = pendingStart.value;
    const end = clampToDuration(videoElement.value.currentTime);

    if (start >= end) {
      setError('End must be after the pending start time.');
      return;
    }

    const nextSegment = {
      id: createSegmentId(),
      type: activeType.value,
      start,
      end
    };

    segments.value = sortSegments([...segments.value, nextSegment]);
    selectedSegmentId.value = nextSegment.id;
    pendingStart.value = null;
    pendingType.value = null;
    statusMessage.value = `Added ${activeType.value} segment ${formatTimestamp(start)} to ${formatTimestamp(end)}.`;
  }

  function toggleMark(type: FilterType) {
    if (pendingStart.value !== null && pendingType.value === type) {
      completeMark(type);
      return;
    }

    startMark(type);
  }

  function updateSegment(id: string, field: 'start' | 'end', rawValue: string) {
    clearFeedback();

    const numericValue = rawValue === '' ? Number.NaN : Number(rawValue);

    segments.value = segments.value.map((segment) => {
      if (segment.id !== id) {
        return segment;
      }

      return {
        ...segment,
        [field]: Number.isFinite(numericValue) ? clampToDuration(numericValue) : numericValue
      };
    });
  }

  function updateSegmentType(id: string, value: string) {
    if (value !== 'mute' && value !== 'skip') {
      return;
    }

    segments.value = segments.value.map((segment) =>
      segment.id === id ? { ...segment, type: value } : segment
    );
  }

  function deleteSegment(id: string) {
    clearFeedback();
    segments.value = segments.value.filter((segment) => segment.id !== id);

    if (selectedSegmentId.value === id) {
      selectedSegmentId.value = null;
    }
  }

  async function importFilterFile(file: File) {
    try {
      clearFeedback();
      const parsed = parseFilterFile(await readTextFile(file));
      segments.value = parsed.filters.map((segment) => ({ ...segment }));
      selectedSegmentId.value = null;
      movieTitle.value = parsed.movie.title ?? movieTitle.value;
      importedMovieDuration.value = parsed.movie.duration;
      pendingStart.value = null;
      pendingType.value = null;
      markFiltersPersisted(segments.value);
      statusMessage.value = `Imported ${parsed.filters.length} filter${parsed.filters.length === 1 ? '' : 's'}.`;
    } catch (error) {
      if (error instanceof FilterValidationError || error instanceof SyntaxError || error instanceof Error) {
        setError(error.message);
        return;
      }

      setError('Unable to import the filter file.');
    }
  }

  async function confirmVideoReplacement(): Promise<boolean> {
    if (!hasUnexportedFilters.value) {
      return true;
    }

    const shouldExportFirst = window.confirm(
      'You have unexported filter changes. Select OK to export them before opening another video.'
    );

    if (shouldExportFirst) {
      return exportFilters();
    }

    return window.confirm(
      'If you open another video now, the current filters will be lost. Select OK to continue without exporting, or Cancel to keep editing.'
    );
  }

  async function openVideo() {
    clearFeedback();

    if (!(await confirmVideoReplacement())) {
      return;
    }

    isOpeningVideo.value = true;
    openVideoProgressPercent.value = 0;
    statusMessage.value = 'Waiting for video selection...';

    try {
      const response = await requestOpenVideoWithProgress();

      if (response.cancelled) {
        statusMessage.value =
          inputPath.value === ''
            ? 'Open a video to begin annotating.'
            : `${inputName.value || 'Current video'} is still ready.`;
        return;
      }

      revokeVideoUrl();
      videoUrl.value = response.playbackUrl ?? null;
      inputPath.value = response.inputPath ?? '';
      inputName.value = response.name ?? '';
      outputPath.value = response.outputPath ?? '';
      playbackSource.value = response.playbackSource ?? 'original';
      movieTitle.value = (response.name ?? '').replace(/\.[^.]+$/, '');
      clearFiltersForNextVideo();
      pendingStart.value = null;
      pendingType.value = null;
      currentTime.value = 0;
      videoDuration.value = 0;
      clearPreviewEffects();
      previewPlaybackEnabled.value = true;
      statusMessage.value =
        playbackSource.value === 'preview'
          ? `Opened ${inputName.value}. Preparing generated preview playback...`
          : `Opened ${inputName.value}.`;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to open the selected video.');
    } finally {
      isOpeningVideo.value = false;
      openVideoProgressPercent.value = 0;
    }
  }

  function updateOutputPath(value: string) {
    outputPath.value = value;
  }

  async function selectProfanitySubtitlePath() {
    clearFeedback();

    if (isOpeningVideo.value || isProcessing.value || inputPath.value === '') {
      return;
    }

    isSelectingSubtitlePath.value = true;

    try {
      const response = await requestJson<SelectSubtitlePathResponse>('/api/select-subtitle-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.cancelled) {
        return;
      }

      profanitySubtitlePath.value = response.subtitlePath ?? '';

      if (profanitySubtitlePath.value !== '') {
        statusMessage.value = `Selected subtitle file ${profanitySubtitlePath.value}.`;
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to select a subtitle file.');
    } finally {
      isSelectingSubtitlePath.value = false;
    }
  }

  function clearProfanitySubtitlePath() {
    profanitySubtitlePath.value = '';
    statusMessage.value = 'Cleared the selected subtitle file.';
  }

  async function analyzeProfanity() {
    clearFeedback();

    if (!canAnalyzeProfanity.value) {
      if (inputPath.value === '') {
        setError('Open a local source file before analyzing profanity.');
      }

      return;
    }

    isAnalyzingProfanity.value = true;
    clearProfanitySuggestions();
    statusMessage.value = `Analyzing ${inputName.value || 'opened video'} for profanity...`;

    try {
      const result = await requestAnalyzeProfanityWithProgress({
        inputPath: inputPath.value,
        movieTitle: movieTitle.value,
        subtitlePath: profanitySubtitlePath.value.trim()
      });

      profanitySuggestions.value = result.suggestions;
      statusMessage.value = result.message;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to analyze profanity.');
    } finally {
      isAnalyzingProfanity.value = false;
      analyzeProfanityProgressPercent.value = 0;
    }
  }

  function discardProfanitySuggestions() {
    clearProfanitySuggestions();
    statusMessage.value = 'Discarded profanity suggestions.';
  }

  function applyProfanitySuggestions() {
    clearFeedback();

    if (profanitySuggestions.value.length === 0) {
      return;
    }

    const nextSegments = profanitySuggestions.value.map((suggestion) => ({
      id: createSegmentId(),
      type: 'mute' as const,
      start: clampToDuration(suggestion.start),
      end: clampToDuration(suggestion.end)
    }));

    segments.value = sortSegments([...segments.value, ...nextSegments]);
    selectedSegmentId.value = nextSegments[0]?.id ?? null;
    clearProfanitySuggestions();
    statusMessage.value = `Applied ${nextSegments.length} profanity suggestion${
      nextSegments.length === 1 ? '' : 's'
    } as mute filters.`;
  }

  async function selectOutputPath() {
    clearFeedback();

    if (isOpeningVideo.value || isProcessing.value || inputPath.value === '') {
      return;
    }

    isSelectingOutputPath.value = true;

    try {
      const response = await requestJson<SelectOutputPathResponse>('/api/select-output-path', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          outputPath: outputPath.value.trim()
        })
      });

      if (response.cancelled || !response.outputPath) {
        return;
      }

      outputPath.value = response.outputPath;
      statusMessage.value = `Selected output path ${response.outputPath}.`;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to select an output path.');
    } finally {
      isSelectingOutputPath.value = false;
    }
  }

  async function processLinkedVideo() {
    clearFeedback();

    if (!canProcessVideo.value) {
      if (inputPath.value === '') {
        setError('Open a local source file before processing.');
        return;
      }

      if (segmentIssues.value.length > 0) {
        setError('Resolve validation issues before processing.');
        return;
      }

      if (isOpeningVideo.value) {
        setError('Wait for the video to finish preparing before processing.');
      }

      return;
    }

    isProcessing.value = true;
    processProgressPercent.value = 0;
    statusMessage.value = `Processing ${inputName.value || 'opened video'}...`;

    try {
      const response = await requestProcessWithProgress({
        inputPath: inputPath.value,
        outputPath: outputPath.value.trim(),
        movieTitle: movieTitle.value,
        filters: segments.value.map((segment) => ({
          id: segment.id,
          type: segment.type,
          start: segment.start,
          end: segment.end
        }))
      });

      outputPath.value = response.outputPath;
      markFiltersPersisted();
      statusMessage.value = response.message;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to process the opened video.');
    } finally {
      isProcessing.value = false;
      processProgressPercent.value = 0;
    }
  }

  async function loadFilterFile(file: File) {
    await importFilterFile(file);
  }

  function exportFilters(): boolean {
    clearFeedback();

    if (!canExport.value) {
      setError('Resolve validation issues before exporting.');
      return false;
    }

    try {
      const normalized = normalizeFilters(
        segments.value.map((segment) => ({
          ...segment,
          start: clampToDuration(segment.start),
          end: clampToDuration(segment.end)
        })),
        { duration: effectiveDuration.value }
      );

      const json = serializeFilterFile({
        version: 1,
        movie: {
          title: movieTitle.value || undefined,
          duration: effectiveDuration.value
        },
        filters: normalized as FilterSegment[]
      });

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${movieTitle.value || 'cleanvid'}.filters.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      markFiltersPersisted();
      statusMessage.value = 'Exported filter JSON.';
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to export the filter file.');
      return false;
    }
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!hasUnexportedFilters.value) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  function selectSegment(id: string | null) {
    selectedSegmentId.value = id;
  }

  function togglePreviewPlayback() {
    previewPlaybackEnabled.value = !previewPlaybackEnabled.value;

    if (!previewPlaybackEnabled.value) {
      clearPreviewEffects();
      return;
    }

    applyPreviewPlayback();
  }

  function seekToRatio(ratio: number) {
    if (!Number.isFinite(ratio)) {
      return;
    }

    seekTo(clampToDuration(effectiveDuration.value * ratio));
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName.toLowerCase();
    return (
      target.isContentEditable ||
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select'
    );
  }

  function handleKeydown(event: KeyboardEvent) {
    if (isEditableTarget(event.target)) {
      return;
    }

    switch (event.key) {
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        void togglePlayback();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        seekBy(event.shiftKey ? -FINE_SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS);
        break;
      case 'ArrowRight':
        event.preventDefault();
        seekBy(event.shiftKey ? FINE_SEEK_STEP_SECONDS : SEEK_STEP_SECONDS);
        break;
      case 'm':
      case 'M':
        event.preventDefault();
        toggleMark('mute');
        break;
      case 's':
      case 'S':
        event.preventDefault();
        toggleMark('skip');
        break;
      default:
        break;
    }
  }

  function cleanup() {
    clearPreviewEffects();
    revokeVideoUrl();
  }

  watch([currentTime, isPlaying, previewPlaybackEnabled, previewTimeline], () => {
    applyPreviewPlayback();
  });

  return {
    SEEK_STEP_SECONDS,
    videoUrl,
    inputPath,
    inputName,
    outputPath,
    playbackSource,
    playbackSourceLabel,
    movieTitle,
    currentTime,
    effectiveDuration,
    isPlaying,
    isOpeningVideo,
    openVideoProgressPercent,
    isSelectingOutputPath,
    isSelectingSubtitlePath,
    isAnalyzingProfanity,
    isProcessing,
    analyzeProfanityProgressPercent,
    processProgressPercent,
    previewPlaybackEnabled,
    previewActiveType,
    activeType,
    pendingStart,
    pendingType,
    statusMessage,
    errorMessage,
    profanitySuggestions,
    profanitySubtitlePath,
    sortedSegments,
    segmentIssues,
    canAnalyzeProfanity,
    canProcessVideo,
    selectedSegmentId,
    activeTypeLabel,
    pendingTypeLabel,
    markerCountLabel,
    profanitySuggestionCountLabel,
    registerVideoElement,
    handleLoadedMetadata,
    handleTimeUpdate,
    handlePlayStateChange,
    togglePlayback,
    seekBy,
    seekTo,
    seekToRatio,
    toggleMark,
    updateSegment,
    updateSegmentType,
    deleteSegment,
    selectSegment,
    togglePreviewPlayback,
    openVideo,
    loadFilterFile,
    selectProfanitySubtitlePath,
    clearProfanitySubtitlePath,
    analyzeProfanity,
    discardProfanitySuggestions,
    applyProfanitySuggestions,
    updateOutputPath,
    selectOutputPath,
    processLinkedVideo,
    exportFilters,
    hasUnexportedFilters,
    handleBeforeUnload,
    handleKeydown,
    cleanup
  };
}
