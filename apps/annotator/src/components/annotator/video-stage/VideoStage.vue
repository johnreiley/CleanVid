<script setup lang="ts">
import { computed, onBeforeUnmount, ref, type ComponentPublicInstance } from 'vue';
import type { FilterType } from '@cleanvid/shared';
import type { EditableSegment } from '../../../annotator-types';
import PlaybackTransport from './PlaybackTransport.vue';
import TimelineTrack from './TimelineTrack.vue';
import VideoViewport from './VideoViewport.vue';

const emit = defineEmits<{
  loadedMetadata: [video: HTMLVideoElement];
  markTypeRequest: [value: FilterType];
  openVideo: [];
  playStateChange: [video: HTMLVideoElement];
  seek: [deltaSeconds: number];
  seekTo: [seconds: number];
  selectSegment: [id: string];
  timeUpdate: [video: HTMLVideoElement];
  togglePreviewPlayback: [];
  togglePlayback: [];
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

const pendingStartPercent = computed(() => {
  if (props.pendingStart === null || props.effectiveDuration <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, (props.pendingStart / props.effectiveDuration) * 100));
});

function getSegmentStyle(segment: EditableSegment) {
  if (props.effectiveDuration <= 0) {
    return {
      left: '0%',
      width: '0%'
    };
  }

  const left = Math.max(0, Math.min(100, (segment.start / props.effectiveDuration) * 100));
  const width = Math.max(
    0,
    Math.min(100 - left, ((segment.end - segment.start) / props.effectiveDuration) * 100)
  );

  return {
    left: `${left}%`,
    width: `max(${width}%, 1px)`
  };
}

function registerTrackElement(element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) {
    timelineTrack.value = element;
    return;
  }

  if (element && '$el' in element && element.$el instanceof HTMLElement) {
    timelineTrack.value = element.$el;
    return;
  }

  timelineTrack.value = null;
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

  if (
    timelineTrack.value &&
    timelinePointerId.value !== null &&
    timelineTrack.value.hasPointerCapture?.(timelinePointerId.value)
  ) {
    timelineTrack.value.releasePointerCapture?.(timelinePointerId.value);
  }

  isTimelineDragging.value = false;
  timelinePointerId.value = null;
}

function handleTimelinePointerDown(event: PointerEvent) {
  if (props.effectiveDuration <= 0) {
    return;
  }

  timelineTrack.value =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : timelineTrack.value;
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

  timelineTrack.value =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : timelineTrack.value;
  seekTimeline(event.clientX);
}

function handleTimelineSegmentClick(segment: EditableSegment) {
  emit('selectSegment', segment.id);
  emit('seekTo', segment.start);
}

onBeforeUnmount(() => {
  releaseTimelineDrag();
});
</script>

<template>
  <section class="video-stage" data-testid="video-stage">
    <VideoViewport
      :active-type="activeType"
      :pending-start="pendingStart"
      :pending-type="pendingType"
      :pending-type-label="pendingTypeLabel"
      :preview-active-type="previewActiveType"
      :register-video-element="registerVideoElement"
      :video-url="videoUrl"
      @loaded-metadata="emit('loadedMetadata', $event)"
      @mark-type-request="emit('markTypeRequest', $event)"
      @open-video="emit('openVideo')"
      @play-state-change="emit('playStateChange', $event)"
      @time-update="emit('timeUpdate', $event)"
    />

    <div class="timeline-rail panel">
      <TimelineTrack
        :current-time="currentTime"
        :effective-duration="effectiveDuration"
        :get-segment-style="getSegmentStyle"
        :handle-segment-click="handleTimelineSegmentClick"
        :handle-track-click="handleTimelineClick"
        :handle-track-pointer-cancel="releaseTimelineDrag"
        :handle-track-pointer-down="handleTimelinePointerDown"
        :handle-track-pointer-move="handleTimelinePointerMove"
        :handle-track-pointer-up="handleTimelinePointerUp"
        :is-timeline-dragging="isTimelineDragging"
        :pending-start-percent="pendingStartPercent"
        :progress-percent="progressPercent"
        :register-track-element="registerTrackElement"
        :sorted-segments="sortedSegments"
      />

      <PlaybackTransport
        :is-playing="isPlaying"
        :preview-playback-enabled="previewPlaybackEnabled"
        @seek="emit('seek', $event)"
        @toggle-playback="emit('togglePlayback')"
        @toggle-preview-playback="emit('togglePreviewPlayback')"
      />
    </div>
  </section>
</template>
