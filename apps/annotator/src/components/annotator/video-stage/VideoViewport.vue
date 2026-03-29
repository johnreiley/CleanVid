<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { FilterType } from '@cleanvid/shared';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import PhMute from '@phosphor-icons-vue-icons/PhSpeakerSimpleX.vue.mjs';
import PhFilmSlate from '@phosphor-icons-vue-icons/PhFilmSlate.vue.mjs';
import { formatTimestamp } from '../../../time';

const emit = defineEmits<{
  loadedMetadata: [video: HTMLVideoElement];
  markTypeRequest: [value: FilterType];
  openVideo: [];
  playStateChange: [video: HTMLVideoElement];
  timeUpdate: [video: HTMLVideoElement];
}>();

const props = defineProps<{
  activeType: FilterType;
  pendingStart: number | null;
  pendingType: FilterType | null;
  pendingTypeLabel: string;
  previewActiveType: FilterType | null;
  registerVideoElement: (element: Element | ComponentPublicInstance | null) => void;
  videoUrl: string | null;
}>();

function getVideoFromEvent(event: Event): HTMLVideoElement | null {
  return event.target instanceof HTMLVideoElement ? event.target : null;
}

function emitVideoEvent(event: Event, name: 'loadedMetadata' | 'playStateChange' | 'timeUpdate') {
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

function handleViewportClick() {
  if (!props.videoUrl) {
    emit('openVideo');
  }
}
</script>

<template>
  <div
    :class="['viewport-card', 'panel', 'panel-dark', { 'viewport-card-empty': !videoUrl }]"
    data-testid="video-dropzone"
    @click="handleViewportClick"
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

    <div class="viewport-overlay viewport-overlay-top">
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

      <div v-if="videoUrl" class="viewport-mark-tools">
        <button
          type="button"
          :class="[
            'viewport-mark-button',
            'viewport-mark-button-mute',
            { 'viewport-mark-button-active': pendingType === 'mute' && pendingStart !== null }
          ]"
          data-testid="overlay-toggle-mute"
          @click.stop="emit('markTypeRequest', 'mute')"
        >
          <PhMute :size="14" weight="bold" />
          <span>M</span>
        </button>
        <button
          type="button"
          :class="[
            'viewport-mark-button',
            'viewport-mark-button-skip',
            { 'viewport-mark-button-active': pendingType === 'skip' && pendingStart !== null }
          ]"
          data-testid="overlay-toggle-skip"
          @click.stop="emit('markTypeRequest', 'skip')"
        >
          <PhSkipForward :size="14" weight="bold" />
          <span>S</span>
        </button>
      </div>
    </div>

    <div v-if="!videoUrl" class="video-placeholder" data-testid="video-placeholder">
      <div class="placeholder-mark">
        <PhFilmSlate class="placeholder-mark-icon" :size="48" />
      </div>
      <p class="video-placeholder-title">Open a video</p>
      <p class="video-placeholder-copy">Select a file to annotate and process</p>
    </div>
  </div>
</template>
