<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { EditableSegment } from '../../../annotator-types';
import { formatTimestamp } from '../../../time';

defineProps<{
  currentTime: number;
  effectiveDuration: number;
  getSegmentStyle: (segment: EditableSegment) => { left: string; width: string };
  handleSegmentClick: (segment: EditableSegment) => void;
  handleTrackClick: (event: MouseEvent) => void;
  handleTrackPointerCancel: (pointerId?: number) => void;
  handleTrackPointerDown: (event: PointerEvent) => void;
  handleTrackPointerMove: (event: PointerEvent) => void;
  handleTrackPointerUp: (event: PointerEvent) => void;
  handleViewportScroll: () => void;
  isTimelineDragging: boolean;
  pendingStartPercent: number | null;
  progressPercent: number;
  registerTrackElement: (element: Element | ComponentPublicInstance | null) => void;
  registerViewportElement: (element: Element | ComponentPublicInstance | null) => void;
  sortedSegments: EditableSegment[];
  timelineZoom: number;
}>();
</script>

<template>
  <div class="timeline-shell">
    <div
      :ref="registerViewportElement"
      class="timeline-track-viewport"
      data-testid="timeline-track-viewport"
      @scroll="handleViewportScroll"
    >
      <button
        :ref="registerTrackElement"
        type="button"
        :class="['timeline-track', { 'timeline-track-dragging': isTimelineDragging }]"
        :style="{ width: `${timelineZoom * 100}%` }"
        data-testid="timeline-track"
        :disabled="effectiveDuration <= 0"
        @click="handleTrackClick"
        @pointerdown="handleTrackPointerDown"
        @pointermove="handleTrackPointerMove"
        @pointerup="handleTrackPointerUp"
        @pointercancel="handleTrackPointerCancel($event.pointerId)"
        @lostpointercapture="handleTrackPointerCancel($event.pointerId)"
      >
        <span
          v-for="segment in sortedSegments"
          :key="segment.id"
          :class="['timeline-segment', `timeline-segment-${segment.type}`]"
          data-testid="timeline-segment"
          :style="getSegmentStyle(segment)"
          @pointerdown.stop
          @click.stop="handleSegmentClick(segment)"
        />

        <span
          v-if="pendingStartPercent !== null"
          class="timeline-pending-start"
          data-testid="timeline-pending-start"
          :style="{ left: `${pendingStartPercent}%` }"
        >
          <span class="timeline-pending-start-line" />
        </span>

        <span class="timeline-caret" data-testid="timeline-caret" :style="{ left: `${progressPercent}%` }">
          <span class="timeline-caret-line" />
        </span>
      </button>
    </div>

    <div class="timeline-labels">
      <span data-testid="current-time">{{ formatTimestamp(currentTime) }}</span>
      <span>{{ formatTimestamp(effectiveDuration) }}</span>
      <span class="timeline-zoom-readout" data-testid="timeline-zoom-readout">Zoom {{ timelineZoom }}x</span>
    </div>
  </div>
</template>
