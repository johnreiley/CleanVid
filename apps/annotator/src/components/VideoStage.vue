<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue';
import PhPause from '@phosphor-icons-vue-icons/PhPause.vue.mjs';
import PhPlay from '@phosphor-icons-vue-icons/PhPlay.vue.mjs';
import PhSkipBack from '@phosphor-icons-vue-icons/PhSkipBack.vue.mjs';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import type { FilterType } from '@cleanvid/shared';
import type { EditableSegment } from '../annotator-types';
import { formatTimestamp } from '../time';

const emit = defineEmits<{
  loadedMetadata: [video: HTMLVideoElement];
  playStateChange: [video: HTMLVideoElement];
  seek: [deltaSeconds: number];
  seekTo: [seconds: number];
  timeUpdate: [video: HTMLVideoElement];
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
  registerVideoElement: (element: Element | ComponentPublicInstance | null) => void;
  sortedSegments: EditableSegment[];
  videoUrl: string | null;
}>();

const isDragActive = ref(false);

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
    width: `${width}%`
  };
}

function handleTimelineClick(event: MouseEvent) {
  const target = event.currentTarget;

  if (!(target instanceof HTMLElement) || props.effectiveDuration <= 0) {
    return;
  }

  const rect = target.getBoundingClientRect();

  if (rect.width <= 0) {
    return;
  }

  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  emit('seekTo', props.effectiveDuration * ratio);
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

      <div v-if="pendingStart !== null && pendingType !== null" class="viewport-hud">
        <span :class="['hud-dot', `hud-dot-${pendingType}`]" />
        <span>{{ pendingTypeLabel }} mode live from {{ formatTimestamp(pendingStart) }}</span>
      </div>

      <label v-if="!videoUrl" class="video-placeholder">
        <input
          data-testid="video-input"
          class="visually-hidden-input"
          type="file"
          accept="video/*"
          @change="emitSelectedVideo"
        />
        <div class="placeholder-mark">+</div>
        <p class="video-placeholder-title">Drop movie here</p>
        <p class="video-placeholder-copy">or click to browse your library</p>
      </label>
    </div>

    <div class="transport-card panel">
      <div class="timeline-shell">
        <button
          type="button"
          class="timeline-track"
          data-testid="timeline-track"
          :disabled="effectiveDuration <= 0"
          @click="handleTimelineClick"
        >
          <span
            v-for="segment in sortedSegments"
            :key="segment.id"
            :class="['timeline-segment', `timeline-segment-${segment.type}`]"
            :style="getSegmentStyle(segment)"
          />
          <span class="timeline-caret" :style="{ left: `${progressPercent}%` }" />
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
          <span class="transport-state">{{ isPlaying ? 'Playing' : 'Paused' }}</span>
          <span class="shortcut-pill">SPACE</span>
          <span class="shortcut-copy">Toggle</span>
          <span class="shortcut-copy">Shift + Arrows fine seek</span>
        </div>
      </div>
    </div>
  </section>
</template>
