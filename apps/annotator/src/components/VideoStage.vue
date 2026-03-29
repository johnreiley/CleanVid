<script setup lang="ts">
import { computed, onBeforeUnmount, ref, type ComponentPublicInstance } from 'vue';
import PhPause from '@phosphor-icons-vue-icons/PhPause.vue.mjs';
import PhPlay from '@phosphor-icons-vue-icons/PhPlay.vue.mjs';
import PhSkipBack from '@phosphor-icons-vue-icons/PhSkipBack.vue.mjs';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import PhFilmSlate from '@phosphor-icons-vue-icons/PhFilmSlate.vue.mjs';
import type { FilterType } from '@cleanvid/shared';
import type { EditableSegment } from '../annotator-types';
import { formatTimestamp } from '../time';

const emit = defineEmits<{
  loadedMetadata: [video: HTMLVideoElement];
  playStateChange: [video: HTMLVideoElement];
  seek: [deltaSeconds: number];
  seekTo: [seconds: number];
  selectSegment: [id: string];
  timeUpdate: [video: HTMLVideoElement];
  togglePreviewPlayback: [];
  togglePlayback: [];
  videoSelected: [file: File];
}>();

const props = defineProps<{
  activeType: FilterType;
  activeTypeLabel: string;
  currentTime: number;
  effectiveDuration: number;
  isPlaying: boolean;
  pendingStart: number | null;
  pendingType: FilterType | null;
  pendingTypeLabel: string;
  previewActiveType: FilterType | null;
  previewPlaybackEnabled: boolean;
  registerVideoElement: (element: Element | ComponentPublicInstance | null) => void;
  sortedSegments: EditableSegment[];
  videoUrl: string | null;
}>();

const isDragActive = ref(false);
const isTimelineDragging = ref(false);
const timelineTrack = ref<HTMLElement | null>(null);
const timelinePointerId = ref<number | null>(null);
const timelineMovedDuringDrag = ref(false);

const progressPercent = computed(() => {
  if (props.effectiveDuration <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (props.currentTime / props.effectiveDuration) * 100));
});

function getVideoFromEvent(event: Event): HTMLVideoElement | null {
  return event.target instanceof HTMLVideoElement ? event.target : null;
}

function emitVideoEvent(
  event: Event,
  name: 'loadedMetadata' | 'playStateChange' | 'timeUpdate'
) {
  const video = getVideoFromEvent(event);

  if (!video) {
    return;
  }

  if (name === 'loadedMetadata') {
    emit('loadedMetadata', video);
    return;
  }

  if (name === 'playStateChange') {
    emit('playStateChange', video);
    return;
  }

  emit('timeUpdate', video);
}

function getSegmentStyle(segment: EditableSegment) {
  if (props.effectiveDuration <= 0) {
    return {
      left: '0%',
      width: '0%'
    };
  }

  const left = Math.max(0, Math.min(100, (segment.start / props.effectiveDuration) * 100));
  const width = Math.max(0, Math.min(100 - left, ((segment.end - segment.start) / props.effectiveDuration) * 100));

  return {
    left: `${left}%`,
    width: `max(${width}%, 1px)`
  };
}

function getTimelineRatio(clientX: number) {
  if (!timelineTrack.value || props.effectiveDuration <= 0) {
    return null;
  }

  const rect = timelineTrack.value.getBoundingClientRect();

  if (rect.width <= 0) {
    return null;
  }

  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function seekTimeline(clientX: number) {
  const ratio = getTimelineRatio(clientX);

  if (ratio === null) {
    return;
  }

  emit('seekTo', props.effectiveDuration * ratio);
}

function releaseTimelineDrag(pointerId?: number) {
  if (pointerId !== undefined && timelinePointerId.value !== pointerId) {
    return;
  }

  if (timelineTrack.value && timelinePointerId.value !== null && timelineTrack.value.hasPointerCapture?.(timelinePointerId.value)) {
    timelineTrack.value.releasePointerCapture?.(timelinePointerId.value);
  }

  isTimelineDragging.value = false;
  timelinePointerId.value = null;
}

function handleTimelinePointerDown(event: PointerEvent) {
  if (props.effectiveDuration <= 0) {
    return;
  }

  timelineTrack.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : timelineTrack.value;
  timelinePointerId.value = event.pointerId;
  timelineMovedDuringDrag.value = false;
  isTimelineDragging.value = true;
  timelineTrack.value?.setPointerCapture?.(event.pointerId);
  seekTimeline(event.clientX);
  event.preventDefault();
}

function handleTimelinePointerMove(event: PointerEvent) {
  if (!isTimelineDragging.value || timelinePointerId.value !== event.pointerId) {
    return;
  }

  timelineMovedDuringDrag.value = true;
  seekTimeline(event.clientX);
}

function handleTimelinePointerUp(event: PointerEvent) {
  if (timelinePointerId.value !== event.pointerId) {
    return;
  }

  seekTimeline(event.clientX);
  releaseTimelineDrag(event.pointerId);
}

function handleTimelineClick(event: MouseEvent) {
  if (timelineMovedDuringDrag.value) {
    timelineMovedDuringDrag.value = false;
    return;
  }

  timelineTrack.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : timelineTrack.value;
  seekTimeline(event.clientX);
}

function handleTimelineSegmentClick(segment: EditableSegment) {
  emit('selectSegment', segment.id);
  emit('seekTo', segment.start);
}

function emitSelectedVideo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    emit('videoSelected', file);
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  isDragActive.value = false;

  const file = event.dataTransfer?.files?.[0];

  if (file) {
    emit('videoSelected', file);
  }
}

onBeforeUnmount(() => {
  releaseTimelineDrag();
});
</script>

<template>
  <section class="video-stage" data-testid="video-stage">
    <div
      :class="['viewport-card panel panel-dark', { 'viewport-card-drag': isDragActive }]"
      data-testid="video-dropzone"
      @dragenter.prevent="isDragActive = true"
      @dragover.prevent="isDragActive = true"
      @dragleave.prevent="isDragActive = false"
      @drop="handleDrop"
    >
      <video
        :ref="registerVideoElement"
        data-testid="video-player"
        class="video-player"
        :src="videoUrl ?? undefined"
        @loadedmetadata="emitVideoEvent($event, 'loadedMetadata')"
        @timeupdate="emitVideoEvent($event, 'timeUpdate')"
        @play="emitVideoEvent($event, 'playStateChange')"
        @pause="emitVideoEvent($event, 'playStateChange')"
      />

      <div
        v-if="(pendingStart !== null && pendingType !== null) || previewActiveType !== null"
        class="viewport-hud-stack"
      >
        <div v-if="pendingStart !== null && pendingType !== null" class="viewport-hud">
          <span :class="['hud-dot', `hud-dot-${pendingType}`]" />
          <span>{{ pendingTypeLabel }} mode live from {{ formatTimestamp(pendingStart) }}</span>
        </div>

        <div
          v-if="previewActiveType !== null"
          :class="['viewport-hud', 'viewport-hud-preview', `viewport-hud-preview-${previewActiveType}`]"
          data-testid="preview-hud"
        >
          <span :class="['hud-dot', `hud-dot-${previewActiveType}`]" />
          <span>{{ previewActiveType === 'mute' ? 'Mute preview' : 'Skip preview' }}</span>
        </div>
      </div>

      <label v-if="!videoUrl" class="video-placeholder">
        <input
          data-testid="video-input"
          class="visually-hidden-input"
          type="file"
          accept="video/*"
          @change="emitSelectedVideo"
        />
        <div class="placeholder-mark">
          <PhFilmSlate class="placeholder-mark-icon" :size="48" />
        </div>
        <p class="video-placeholder-title">Drop movie here</p>
        <p class="video-placeholder-copy">or click to browse your library</p>
      </label>
    </div>

    <div class="transport-card panel">
      <div class="timeline-shell">
        <button
          ref="timelineTrack"
          type="button"
          :class="['timeline-track', { 'timeline-track-dragging': isTimelineDragging }]"
          data-testid="timeline-track"
          :disabled="effectiveDuration <= 0"
          @click="handleTimelineClick"
          @pointerdown="handleTimelinePointerDown"
          @pointermove="handleTimelinePointerMove"
          @pointerup="handleTimelinePointerUp"
          @pointercancel="releaseTimelineDrag($event.pointerId)"
          @lostpointercapture="releaseTimelineDrag($event.pointerId)"
        >
          <span
            v-for="segment in sortedSegments"
            :key="segment.id"
            :class="['timeline-segment', `timeline-segment-${segment.type}`]"
            data-testid="timeline-segment"
            :style="getSegmentStyle(segment)"
            @pointerdown.stop
            @click.stop="handleTimelineSegmentClick(segment)"
          />
          <span class="timeline-caret" data-testid="timeline-caret" :style="{ left: `${progressPercent}%` }">
            <span class="timeline-caret-line" />
          </span>
        </button>

        <div class="timeline-labels">
          <span data-testid="current-time">{{ formatTimestamp(currentTime) }}</span>
          <span>{{ formatTimestamp(effectiveDuration) }}</span>
        </div>
      </div>

      <div class="transport-bar" data-testid="transport-bar">
        <div class="transport-cluster">
          <button
            type="button"
            class="icon-button icon-button-ghost"
            aria-label="Rewind 5 seconds"
            title="Rewind 5 seconds"
            @click="emit('seek', -5)"
          >
            <PhSkipBack :size="18" weight="fill" />
          </button>
          <button
            type="button"
            class="icon-button icon-button-primary"
            :aria-label="isPlaying ? 'Pause playback' : 'Play video'"
            :title="isPlaying ? 'Pause playback' : 'Play video'"
            @click="emit('togglePlayback')"
          >
            <PhPause v-if="isPlaying" :size="22" weight="fill" />
            <PhPlay v-else :size="22" weight="fill" />
          </button>
          <button
            type="button"
            class="icon-button icon-button-ghost"
            aria-label="Forward 5 seconds"
            title="Forward 5 seconds"
            @click="emit('seek', 5)"
          >
            <PhSkipForward :size="18" weight="fill" />
          </button>
        </div>

        <div class="transport-meta">
          <button
            type="button"
            :class="['preview-toggle', { 'preview-toggle-enabled': previewPlaybackEnabled }]"
            data-testid="preview-toggle"
            @click="emit('togglePreviewPlayback')"
          >
            <span class="preview-toggle-indicator" />
            <span>{{ previewPlaybackEnabled ? 'Preview On' : 'Preview Off' }}</span>
          </button>
          <span class="shortcut-pill">SPACE</span>
          <span class="shortcut-copy">Toggle Play/Pause</span>
          <span class="shortcut-pill">←/→ Arrows</span>
          <span class="shortcut-copy">Seek</span>
          <span class="shortcut-pill">Shift + ←/→ Arrows</span>
          <span class="shortcut-copy">Fine seek</span>
        </div>
      </div>
    </div>
  </section>
</template>
