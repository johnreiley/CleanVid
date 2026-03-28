<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PhPause from '@phosphor-icons-vue-icons/PhPause.vue.mjs';
import PhPlay from '@phosphor-icons-vue-icons/PhPlay.vue.mjs';
import PhSkipBack from '@phosphor-icons-vue-icons/PhSkipBack.vue.mjs';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import {
  FilterValidationError,
  normalizeFilters,
  parseFilterFile,
  serializeFilterFile,
  type FilterSegment,
  type FilterType
} from '@cleanvid/shared';
import { formatTimestamp } from './time';

interface EditableSegment {
  id: string;
  type: FilterType;
  start: number;
  end: number;
}

interface SegmentIssue {
  id: string;
  messages: string[];
}

const SEEK_STEP_SECONDS = 5;

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

const videoElement = ref<HTMLVideoElement | null>(null);
const videoUrl = ref<string | null>(null);
const videoName = ref('');
const movieTitle = ref('');
const importedMovieDuration = ref(0);
const currentTime = ref(0);
const videoDuration = ref(0);
const isPlaying = ref(false);
const activeType = ref<FilterType>('mute');
const pendingStart = ref<number | null>(null);
const segments = ref<EditableSegment[]>([]);
const statusMessage = ref('Load a local video to begin annotating.');
const errorMessage = ref('');

const effectiveDuration = computed(() => videoDuration.value || importedMovieDuration.value || 0);

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

function revokeVideoUrl() {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value);
    videoUrl.value = null;
  }
}

function handleLoadedMetadata() {
  videoDuration.value = Number.isFinite(videoElement.value?.duration) ? videoElement.value?.duration ?? 0 : 0;
  statusMessage.value = 'Video ready. Mark start and end points to create segments.';
  segments.value = segments.value.map((segment) => ({
    ...segment,
    start: clampToDuration(segment.start),
    end: clampToDuration(segment.end)
  }));
  syncVideoState();
}

function handleTimeUpdate() {
  syncVideoState();
}

function handlePlayStateChange() {
  syncVideoState();
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
}

function seekBy(deltaSeconds: number) {
  clearFeedback();

  if (!videoElement.value) {
    return;
  }

  videoElement.value.currentTime = clampToDuration(videoElement.value.currentTime + deltaSeconds);
  syncVideoState();
}

function seekTo(start: number) {
  if (!videoElement.value) {
    return;
  }

  videoElement.value.currentTime = clampToDuration(start);
  syncVideoState();
}

function markStart() {
  clearFeedback();

  if (!canMark.value || !videoElement.value) {
    setError('Load a video before marking a segment.');
    return;
  }

  pendingStart.value = clampToDuration(videoElement.value.currentTime);
  statusMessage.value = `Start marked at ${formatTimestamp(pendingStart.value)}.`;
}

function markEnd() {
  clearFeedback();

  if (!canMark.value || !videoElement.value) {
    setError('Load a video before marking a segment.');
    return;
  }

  if (pendingStart.value === null) {
    setError('Mark a start time before marking the end.');
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

  segments.value = sortSegments([
    ...segments.value,
    nextSegment
  ]);

  pendingStart.value = null;
  statusMessage.value = `Added ${activeType.value} segment ${formatTimestamp(start)} to ${formatTimestamp(end)}.`;
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

function handleSegmentTypeChange(id: string, event: Event) {
  updateSegmentType(id, (event.target as HTMLSelectElement).value);
}

function handleSegmentNumberInput(id: string, field: 'start' | 'end', event: Event) {
  updateSegment(id, field, (event.target as HTMLInputElement).value);
}

function deleteSegment(id: string) {
  clearFeedback();
  segments.value = segments.value.filter((segment) => segment.id !== id);
}

async function importFilterFile(file: File) {
  try {
    clearFeedback();
    const parsed = parseFilterFile(await readTextFile(file));
    segments.value = parsed.filters.map((segment) => ({ ...segment }));
    movieTitle.value = parsed.movie.title ?? movieTitle.value;
    importedMovieDuration.value = parsed.movie.duration;
    pendingStart.value = null;
    statusMessage.value = `Imported ${parsed.filters.length} segment${parsed.filters.length === 1 ? '' : 's'}.`;
  } catch (error) {
    if (error instanceof FilterValidationError || error instanceof SyntaxError || error instanceof Error) {
      setError(error.message);
      return;
    }

    setError('Unable to import the filter file.');
  }
}

async function handleVideoSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  revokeVideoUrl();
  videoUrl.value = URL.createObjectURL(file);
  videoName.value = file.name;
  movieTitle.value = file.name.replace(/\.[^.]+$/, '');
  pendingStart.value = null;
  currentTime.value = 0;
  videoDuration.value = 0;
  statusMessage.value = `Loaded ${file.name}.`;
  clearFeedback();
}

async function handleFilterSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function formatSegmentType(type: FilterType): string {
  return type === 'mute' ? 'Mute' : 'Skip';
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
      seekBy(-SEEK_STEP_SECONDS);
      break;
    case 'ArrowRight':
      event.preventDefault();
      seekBy(SEEK_STEP_SECONDS);
      break;
    case 's':
    case 'S':
      event.preventDefault();
      markStart();
      break;
    case 'e':
    case 'E':
      event.preventDefault();
      markEnd();
      break;
    default:
      break;
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  revokeVideoUrl();
});
</script>

<template>
  <div class="app-shell">
    <header class="top-bar" data-testid="top-bar">
      <div class="brand-block">
        <p class="eyebrow">CleanVid Annotator</p>
        <h1>Local editing workspace for mute and skip markers</h1>
      </div>

      <div class="top-meta">
        <div class="meta-chip">
          <span class="meta-label">Movie</span>
          <strong>{{ movieTitle || videoName || 'No file loaded' }}</strong>
        </div>
        <div class="meta-chip">
          <span class="meta-label">Markers</span>
          <strong>{{ markerCountLabel }}</strong>
        </div>
      </div>

      <div class="top-actions">
        <label class="file-action">
          <span>Load Video</span>
          <input data-testid="video-input" type="file" accept="video/*" @change="handleVideoSelected" />
        </label>

        <label class="file-action">
          <span>Import Filters</span>
          <input
            data-testid="filters-input"
            type="file"
            accept="application/json,.json"
            @change="handleFilterSelected"
          />
        </label>

        <button type="button" class="primary-button" data-testid="export-button" @click="exportFilters">
          Export JSON
        </button>
      </div>
    </header>

    <main class="workspace" data-testid="workspace">
      <section class="video-stage panel panel-dark" data-testid="video-stage">
        <div class="section-heading">
          <div>
            <p class="section-kicker">Viewer</p>
            <h2>Preview and place edit points</h2>
          </div>
          <div class="stage-badge">
            <span class="badge-label">Active Marker</span>
            <span :class="['type-pill', `type-pill-${activeType}`]">{{ activeTypeLabel }}</span>
          </div>
        </div>

        <div class="video-stage-body">
          <video
            ref="videoElement"
            data-testid="video-player"
            class="video-player"
            controls
            :src="videoUrl ?? undefined"
            @loadedmetadata="handleLoadedMetadata"
            @timeupdate="handleTimeUpdate"
            @play="handlePlayStateChange"
            @pause="handlePlayStateChange"
          />
        </div>

        <dl class="info-strip">
          <div class="info-chip">
            <dt>Current</dt>
            <dd data-testid="current-time">{{ formatTimestamp(currentTime) }}</dd>
          </div>
          <div class="info-chip">
            <dt>Duration</dt>
            <dd>{{ formatTimestamp(effectiveDuration) }}</dd>
          </div>
          <div class="info-chip">
            <dt>Pending Start</dt>
            <dd :class="{ pending: pendingStart !== null }">
              {{ pendingStart === null ? 'None' : formatTimestamp(pendingStart) }}
            </dd>
          </div>
          <div class="info-chip">
            <dt>Playback</dt>
            <dd>{{ isPlaying ? 'Playing' : 'Paused' }}</dd>
          </div>
        </dl>
      </section>

      <section class="control-rail" data-testid="control-rail">
        <article class="panel control-card">
          <div class="section-heading compact-heading">
            <div>
              <p class="section-kicker">Transport</p>
              <h2>Playback</h2>
            </div>
          </div>

          <div class="transport-cluster">
            <button
              type="button"
              class="icon-button"
              :aria-label="`Rewind ${SEEK_STEP_SECONDS} seconds`"
              :title="`Rewind ${SEEK_STEP_SECONDS} seconds`"
              @click="seekBy(-SEEK_STEP_SECONDS)"
            >
              <PhSkipBack :size="18" weight="fill" />
            </button>
            <button
              type="button"
              class="icon-button icon-button-primary"
              :aria-label="isPlaying ? 'Pause playback' : 'Play video'"
              :title="isPlaying ? 'Pause playback' : 'Play video'"
              @click="togglePlayback"
            >
              <PhPause v-if="isPlaying" :size="20" weight="fill" />
              <PhPlay v-else :size="20" weight="fill" />
            </button>
            <button
              type="button"
              class="icon-button"
              :aria-label="`Forward ${SEEK_STEP_SECONDS} seconds`"
              :title="`Forward ${SEEK_STEP_SECONDS} seconds`"
              @click="seekBy(SEEK_STEP_SECONDS)"
            >
              <PhSkipForward :size="18" weight="fill" />
            </button>
          </div>
        </article>

        <article class="panel control-card">
          <div class="section-heading compact-heading">
            <div>
              <p class="section-kicker">Marker Tools</p>
              <h2>Create marker</h2>
            </div>
          </div>

          <label class="field">
            <span>Marker Type</span>
            <select v-model="activeType" data-testid="active-type">
              <option value="mute">Mute</option>
              <option value="skip">Skip</option>
            </select>
          </label>

          <div class="button-stack">
            <button type="button" class="primary-button" data-testid="mark-start" @click="markStart">
              Mark Start
            </button>
            <button type="button" class="primary-button accent-button" data-testid="mark-end" @click="markEnd">
              Mark End
            </button>
          </div>

          <p class="shortcut-note">Shortcuts: <span>S</span> start, <span>E</span> end, <span>Space</span> play</p>
        </article>

        <article class="panel control-card">
          <div class="section-heading compact-heading">
            <div>
              <p class="section-kicker">Feedback</p>
              <h2>Session state</h2>
            </div>
          </div>

          <p class="status" data-testid="status-message">{{ statusMessage }}</p>
          <p v-if="errorMessage" class="error" data-testid="error-message">{{ errorMessage }}</p>
          <p v-else-if="segmentIssues.length > 0" class="warning-text">
            {{ segmentIssues.length }} validation issue{{ segmentIssues.length === 1 ? '' : 's' }} need attention.
          </p>
          <p v-else class="hint-text">
            Marker edits are live. Export when the list is valid and ready for the CLI.
          </p>
        </article>
      </section>

      <section class="markers-panel panel" data-testid="markers-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">Markers</p>
            <h2>Existing segments</h2>
          </div>
          <span class="panel-count">{{ sortedSegments.length }} total</span>
        </div>

        <p v-if="sortedSegments.length === 0" class="empty-state">
          No segments yet. Load a video, choose a type, then mark start and end points.
        </p>

        <ul v-else class="segment-list" data-testid="segment-list">
          <li v-for="segment in sortedSegments" :key="segment.id" class="segment-card">
            <div class="segment-summary">
              <div class="segment-summary-main">
                <span :class="['type-pill', `type-pill-${segment.type}`]">{{ formatSegmentType(segment.type) }}</span>
                <button type="button" class="segment-link" @click="seekTo(segment.start)">
                  {{ formatTimestamp(segment.start) }} - {{ formatTimestamp(segment.end) }}
                </button>
              </div>
              <span class="segment-id">{{ segment.id }}</span>
            </div>

            <div class="segment-grid">
              <label class="field">
                <span>Type</span>
                <select :value="segment.type" @change="handleSegmentTypeChange(segment.id, $event)">
                  <option value="mute">Mute</option>
                  <option value="skip">Skip</option>
                </select>
              </label>

              <label class="field">
                <span>Start</span>
                <input
                  :value="Number.isFinite(segment.start) ? segment.start : ''"
                  type="number"
                  step="0.1"
                  @input="handleSegmentNumberInput(segment.id, 'start', $event)"
                />
              </label>

              <label class="field">
                <span>End</span>
                <input
                  :value="Number.isFinite(segment.end) ? segment.end : ''"
                  type="number"
                  step="0.1"
                  @input="handleSegmentNumberInput(segment.id, 'end', $event)"
                />
              </label>

              <button type="button" class="danger-button" @click="deleteSegment(segment.id)">Delete</button>
            </div>
          </li>
        </ul>

        <div v-if="segmentIssues.length > 0" class="validation-list">
          <h3>Validation Issues</h3>
          <ul>
            <li v-for="issue in segmentIssues" :key="issue.id">
              {{ issue.id }}: {{ issue.messages.join(' ') }}
            </li>
          </ul>
        </div>
      </section>
    </main>
  </div>
</template>
