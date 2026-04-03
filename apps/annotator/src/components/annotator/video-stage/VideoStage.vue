<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import type { FilterType } from '@cleanvid/shared';
import type { EditableSegment } from '../../../annotator-types';
import PlaybackTransport from './PlaybackTransport.vue';
import TimelineTrack from './TimelineTrack.vue';
import VideoViewport from './VideoViewport.vue';

const TIMELINE_CARET_VIEW_PADDING = 24;
const MANUAL_TIMELINE_SCROLL_IDLE_MS = 140;

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
  timelineZoom: number;
  videoUrl: string | null;
}>();

const isTimelineDragging = ref(false);
const isProgrammaticTimelineScroll = ref(false);
const isUserTimelineScrolling = ref(false);
const timelineCaretAutoFollowMode = ref<'enabled' | 'paused-catchup' | 'paused-right-hidden'>(
  'enabled'
);
const timelineViewport = ref<HTMLElement | null>(null);
const timelineTrack = ref<HTMLElement | null>(null);
const timelinePointerId = ref<number | null>(null);
const timelineMovedDuringDrag = ref(false);
let programmaticTimelineScrollResetId: number | null = null;
let manualTimelineScrollIdleResetId: number | null = null;

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

function registerViewportElement(element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) {
    timelineViewport.value = element;
    return;
  }

  if (element && '$el' in element && element.$el instanceof HTMLElement) {
    timelineViewport.value = element.$el;
    return;
  }

  timelineViewport.value = null;
}

function getTimelineTrackWidth() {
  const viewportWidth = timelineViewport.value?.clientWidth ?? 0;
  if (viewportWidth > 0) {
    return viewportWidth * props.timelineZoom;
  }

  if (!timelineTrack.value) {
    return 0;
  }

  return Math.max(timelineTrack.value.scrollWidth, timelineTrack.value.getBoundingClientRect().width);
}

function getTimelineRatio(clientX: number) {
  if (!timelineViewport.value || !timelineTrack.value || props.effectiveDuration <= 0) {
    return null;
  }

  const rect = timelineViewport.value.getBoundingClientRect();
  const trackWidth = getTimelineTrackWidth();

  if (rect.width <= 0 || trackWidth <= 0) {
    return null;
  }

  const offset = clientX - rect.left + timelineViewport.value.scrollLeft;

  return Math.max(0, Math.min(1, offset / trackWidth));
}

function seekTimeline(clientX: number) {
  const ratio = getTimelineRatio(clientX);

  if (ratio === null) {
    return;
  }

  const nextTime = props.effectiveDuration * ratio;

  if (Math.abs(nextTime - props.currentTime) > 0.001) {
    timelineCaretAutoFollowMode.value = 'enabled';
  }

  emit('seekTo', nextTime);
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
  if (Math.abs(segment.start - props.currentTime) > 0.001) {
    timelineCaretAutoFollowMode.value = 'enabled';
  }

  emit('selectSegment', segment.id);
  emit('seekTo', segment.start);
}

function scheduleProgrammaticTimelineScrollReset() {
  if (programmaticTimelineScrollResetId !== null) {
    window.clearTimeout(programmaticTimelineScrollResetId);
  }

  programmaticTimelineScrollResetId = window.setTimeout(() => {
    isProgrammaticTimelineScroll.value = false;
    programmaticTimelineScrollResetId = null;
  }, 0);
}

function setTimelineViewportScrollLeft(scrollLeft: number) {
  if (!timelineViewport.value) {
    return;
  }

  isProgrammaticTimelineScroll.value = true;
  timelineViewport.value.scrollLeft = scrollLeft;
  scheduleProgrammaticTimelineScrollReset();
}

function handleTimelineViewportScroll() {
  if (isProgrammaticTimelineScroll.value) {
    return;
  }

  if (!props.isPlaying || props.timelineZoom <= 1) {
    return;
  }

  isUserTimelineScrolling.value = true;

  if (manualTimelineScrollIdleResetId !== null) {
    window.clearTimeout(manualTimelineScrollIdleResetId);
  }

  manualTimelineScrollIdleResetId = window.setTimeout(() => {
    isUserTimelineScrolling.value = false;
    manualTimelineScrollIdleResetId = null;
    maybeResumeTimelineCaretAutoFollow(props.currentTime);
  }, MANUAL_TIMELINE_SCROLL_IDLE_MS);

  const hiddenSide = getTimelineCaretHiddenSide(props.currentTime);

  if (hiddenSide === 'right') {
    timelineCaretAutoFollowMode.value = 'paused-right-hidden';
    return;
  }

  if (hiddenSide === 'left') {
    timelineCaretAutoFollowMode.value = 'paused-catchup';
    return;
  }

  if (timelineCaretAutoFollowMode.value === 'paused-right-hidden') {
    timelineCaretAutoFollowMode.value = 'paused-catchup';
  }
}

function getTimelineCaretOffset(timeSeconds: number) {
  const trackWidth = getTimelineTrackWidth();

  return Math.max(0, Math.min(trackWidth, (timeSeconds / props.effectiveDuration) * trackWidth));
}

function getTimelineViewportBounds() {
  if (!timelineViewport.value) {
    return null;
  }

  const viewportWidth = timelineViewport.value.clientWidth;

  return {
    leftBound: timelineViewport.value.scrollLeft + TIMELINE_CARET_VIEW_PADDING,
    rightBound: timelineViewport.value.scrollLeft + viewportWidth - TIMELINE_CARET_VIEW_PADDING,
    viewportWidth
  };
}

function getTimelineCaretHiddenSide(timeSeconds: number): 'left' | 'right' | null {
  if (!timelineViewport.value || props.effectiveDuration <= 0 || props.timelineZoom <= 1) {
    return null;
  }

  const bounds = getTimelineViewportBounds();

  if (!bounds) {
    return null;
  }

  const caretOffset = getTimelineCaretOffset(timeSeconds);

  if (caretOffset < bounds.leftBound) {
    return 'left';
  }

  if (caretOffset > bounds.rightBound) {
    return 'right';
  }

  return null;
}

function maybeResumeTimelineCaretAutoFollow(timeSeconds: number) {
  if (
    !timelineViewport.value ||
    timelineCaretAutoFollowMode.value !== 'paused-catchup' ||
    isUserTimelineScrolling.value ||
    props.effectiveDuration <= 0 ||
    props.timelineZoom <= 1
  ) {
    return;
  }

  const bounds = getTimelineViewportBounds();

  if (!bounds) {
    return;
  }

  const caretOffset = getTimelineCaretOffset(timeSeconds);

  if (caretOffset < bounds.rightBound) {
    return;
  }

  timelineCaretAutoFollowMode.value = 'enabled';
  keepTimelineCaretInView(timeSeconds);
}

function centerTimelineOnTime(timeSeconds: number) {
  if (!timelineViewport.value || props.effectiveDuration <= 0) {
    return;
  }

  const viewportWidth = timelineViewport.value.clientWidth;
  const trackWidth = getTimelineTrackWidth();

  if (viewportWidth <= 0 || trackWidth <= viewportWidth) {
    setTimelineViewportScrollLeft(0);
    return;
  }

  const ratio = Math.max(0, Math.min(1, timeSeconds / props.effectiveDuration));
  const centeredOffset = trackWidth * ratio - viewportWidth / 2;
  const maxScrollLeft = Math.max(0, trackWidth - viewportWidth);

  setTimelineViewportScrollLeft(Math.max(0, Math.min(maxScrollLeft, centeredOffset)));
}

function keepTimelineCaretInView(timeSeconds: number) {
  if (!timelineViewport.value || props.effectiveDuration <= 0 || props.timelineZoom <= 1) {
    return;
  }

  if (isTimelineDragging.value || timelineCaretAutoFollowMode.value !== 'enabled') {
    return;
  }

  const viewportWidth = timelineViewport.value.clientWidth;
  const trackWidth = getTimelineTrackWidth();

  if (viewportWidth <= 0 || trackWidth <= viewportWidth) {
    setTimelineViewportScrollLeft(0);
    return;
  }

  const maxScrollLeft = Math.max(0, trackWidth - viewportWidth);
  const caretOffset = getTimelineCaretOffset(timeSeconds);
  const bounds = getTimelineViewportBounds();

  if (!bounds) {
    return;
  }

  const { leftBound, rightBound } = bounds;

  if (caretOffset < leftBound) {
    setTimelineViewportScrollLeft(
      Math.max(0, Math.min(maxScrollLeft, caretOffset - TIMELINE_CARET_VIEW_PADDING))
    );
    return;
  }

  if (caretOffset > rightBound) {
    setTimelineViewportScrollLeft(
      Math.max(
        0,
        Math.min(maxScrollLeft, caretOffset - viewportWidth + TIMELINE_CARET_VIEW_PADDING)
      )
    );
  }
}

watch(
  () => props.timelineZoom,
  async () => {
    await nextTick();
    centerTimelineOnTime(props.currentTime);
  }
);

watch(
  () => props.currentTime,
  (currentTime, previousTime) => {
    if (currentTime === previousTime) {
      return;
    }

    maybeResumeTimelineCaretAutoFollow(currentTime);
    keepTimelineCaretInView(currentTime);
  }
);

onBeforeUnmount(() => {
  if (programmaticTimelineScrollResetId !== null) {
    window.clearTimeout(programmaticTimelineScrollResetId);
  }

  if (manualTimelineScrollIdleResetId !== null) {
    window.clearTimeout(manualTimelineScrollIdleResetId);
  }

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
        :handle-viewport-scroll="handleTimelineViewportScroll"
        :register-track-element="registerTrackElement"
        :register-viewport-element="registerViewportElement"
        :sorted-segments="sortedSegments"
        :timeline-zoom="timelineZoom"
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
