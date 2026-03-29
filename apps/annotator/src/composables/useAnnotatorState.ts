import { computed, ref, watch, type ComponentPublicInstance } from 'vue';
import {
  FilterValidationError,
  buildTimeline,
  normalizeFilters,
  parseFilterFile,
  serializeFilterFile,
  type FilterSegment,
  type FilterType,
  type TimelineSegment
} from '@cleanvid/shared';
import type { EditableSegment, SegmentIssue } from '../annotator-types';
import { formatTimestamp } from '../time';

const SEEK_STEP_SECONDS = 5;
const FINE_SEEK_STEP_SECONDS = 0.1;

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

export function useAnnotatorState() {
  const videoElement = ref<HTMLVideoElement | null>(null);
  const videoUrl = ref<string | null>(null);
  const videoName = ref('');
  const movieTitle = ref('');
  const importedMovieDuration = ref(0);
  const currentTime = ref(0);
  const videoDuration = ref(0);
  const isPlaying = ref(false);
  const previewPlaybackEnabled = ref(true);
  const previewActiveType = ref<FilterType | null>(null);
  const activeType = ref<FilterType>('mute');
  const pendingStart = ref<number | null>(null);
  const pendingType = ref<FilterType | null>(null);
  const segments = ref<EditableSegment[]>([]);
  const selectedSegmentId = ref<string | null>(null);
  const statusMessage = ref('Load a local video to begin annotating.');
  const errorMessage = ref('');
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
  const sortedSegments = computed(() => sortSegments(segments.value));
  const activeTypeLabel = computed(() => (activeType.value === 'mute' ? 'Mute' : 'Skip'));
  const pendingTypeLabel = computed(() =>
    pendingType.value === null ? '' : pendingType.value === 'mute' ? 'Mute' : 'Skip'
  );
  const markerCountLabel = computed(
    () => `${sortedSegments.value.length} marker${sortedSegments.value.length === 1 ? '' : 's'}`
  );

  function clearFeedback() {
    errorMessage.value = '';
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
    if (videoUrl.value) {
      URL.revokeObjectURL(videoUrl.value);
      videoUrl.value = null;
    }
  }

  function registerVideoElement(element: Element | ComponentPublicInstance | null) {
    videoElement.value = element instanceof HTMLVideoElement ? element : null;
  }

  function handleLoadedMetadata(video?: HTMLVideoElement | null) {
    if (video) {
      videoElement.value = video;
    }

    videoDuration.value = Number.isFinite(videoElement.value?.duration) ? videoElement.value?.duration ?? 0 : 0;
    statusMessage.value = 'Video ready. Use [M] or [S] to mark segments while the video plays.';
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
      setError('Load a video before marking a segment.');
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
      setError('Load a video before marking a segment.');
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
      statusMessage.value = `Imported ${parsed.filters.length} segment${parsed.filters.length === 1 ? '' : 's'}.`;
    } catch (error) {
      if (error instanceof FilterValidationError || error instanceof SyntaxError || error instanceof Error) {
        setError(error.message);
        return;
      }

      setError('Unable to import the filter file.');
    }
  }

  async function loadVideoFile(file: File) {
    revokeVideoUrl();
    videoUrl.value = URL.createObjectURL(file);
    videoName.value = file.name;
    movieTitle.value = file.name.replace(/\.[^.]+$/, '');
    pendingStart.value = null;
    pendingType.value = null;
    currentTime.value = 0;
    videoDuration.value = 0;
    statusMessage.value = `Loaded ${file.name}.`;
    clearFeedback();
    previewPlaybackEnabled.value = true;
    clearPreviewEffects();
  }

  async function loadFilterFile(file: File) {
    await importFilterFile(file);
  }

  function exportFilters() {
    clearFeedback();

    if (!canExport.value) {
      setError('Resolve validation issues before exporting.');
      return;
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
      statusMessage.value = 'Exported filter JSON.';
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to export the filter file.');
    }
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
    videoName,
    movieTitle,
    currentTime,
    effectiveDuration,
    isPlaying,
    previewPlaybackEnabled,
    previewActiveType,
    activeType,
    pendingStart,
    pendingType,
    statusMessage,
    errorMessage,
    sortedSegments,
    segmentIssues,
    selectedSegmentId,
    activeTypeLabel,
    pendingTypeLabel,
    markerCountLabel,
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
    loadVideoFile,
    loadFilterFile,
    exportFilters,
    handleKeydown,
    cleanup
  };
}
