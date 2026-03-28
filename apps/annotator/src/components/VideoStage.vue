<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { FilterType } from '@cleanvid/shared';
import { formatTimestamp } from '../time';

const emit = defineEmits<{
  loadedMetadata: [video: HTMLVideoElement];
  playStateChange: [video: HTMLVideoElement];
  timeUpdate: [video: HTMLVideoElement];
}>();

defineProps<{
  activeType: FilterType;
  activeTypeLabel: string;
  currentTime: number;
  effectiveDuration: number;
  isPlaying: boolean;
  pendingStart: number | null;
  registerVideoElement: (element: Element | ComponentPublicInstance | null) => void;
  videoUrl: string | null;
}>();

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
</script>

<template>
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
        :ref="registerVideoElement"
        data-testid="video-player"
        class="video-player"
        controls
        :src="videoUrl ?? undefined"
        @loadedmetadata="emitVideoEvent($event, 'loadedMetadata')"
        @timeupdate="emitVideoEvent($event, 'timeUpdate')"
        @play="emitVideoEvent($event, 'playStateChange')"
        @pause="emitVideoEvent($event, 'playStateChange')"
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
</template>
