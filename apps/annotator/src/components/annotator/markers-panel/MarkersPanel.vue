<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import type { EditableSegment, SegmentIssue } from '../../../annotator-types';
import MarkActionTiles from './MarkActionTiles.vue';
import ProcessingOptionsSection from './ProcessingOptionsSection.vue';
import SegmentsSection from './SegmentsSection.vue';
import SessionActions from './SessionActions.vue';
import StatusToast from './StatusToast.vue';

const emit = defineEmits<{
  activeTypeChange: [value: FilterType];
  deleteSegment: [id: string];
  filtersSelected: [file: File];
  openVideo: [];
  processLinkedVideo: [];
  seek: [start: number];
  selectSegment: [id: string | null];
  toggleMark: [value: FilterType];
  updateOutputPath: [value: string];
  updateSegment: [payload: { id: string; field: 'start' | 'end'; value: string }];
}>();

const props = defineProps<{
  activeType: FilterType;
  canProcessVideo: boolean;
  errorMessage: string;
  isOpeningVideo: boolean;
  isProcessing: boolean;
  markerCountLabel: string;
  outputPath: string;
  processProgressPercent: number;
  pendingStart: number | null;
  pendingType: FilterType | null;
  selectionScrollKey: number;
  segmentIssues: SegmentIssue[];
  selectedSegmentId: string | null;
  sortedSegments: EditableSegment[];
  statusMessage: string;
}>();

const segmentCards = new Map<string, HTMLElement>();
const activeToast = ref<{ kind: 'error' | 'status'; message: string; key: string } | null>(null);
const isProcessingExpanded = ref(true);
const isSegmentsExpanded = ref(true);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const clampedProcessProgressPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(props.processProgressPercent)))
);
const processButtonLabel = computed(() =>
  props.isProcessing ? `Exporting ${clampedProcessProgressPercent.value}%` : 'Export Video'
);

function clearToastTimer() {
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

function dismissToast() {
  clearToastTimer();
  activeToast.value = null;
}

function showToast(kind: 'error' | 'status', message: string) {
  const key = `${kind}:${message}`;

  activeToast.value = { kind, message, key };
  clearToastTimer();
  toastTimer = setTimeout(() => {
    if (activeToast.value?.key === key) {
      activeToast.value = null;
    }
    clearToastTimer();
  }, 5000);
}

function toggleProcessingSection() {
  isProcessingExpanded.value = !isProcessingExpanded.value;
}

function toggleSegmentsSection() {
  isSegmentsExpanded.value = !isSegmentsExpanded.value;
}

function handleMarkTypeRequest(type: FilterType) {
  emit('activeTypeChange', type);
  emit('toggleMark', type);
}

function registerSegmentCard(id: string, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) {
    segmentCards.set(id, element);
    return;
  }

  if (element && '$el' in element && element.$el instanceof HTMLElement) {
    segmentCards.set(id, element.$el);
    return;
  }

  segmentCards.delete(id);
}

watch(
  [() => props.selectedSegmentId, () => props.selectionScrollKey],
  async ([selectedSegmentId]) => {
    if (!selectedSegmentId) {
      return;
    }

    await nextTick();
    const segmentCard = segmentCards.get(selectedSegmentId);

    if (segmentCard && typeof segmentCard.scrollIntoView === 'function') {
      segmentCard.scrollIntoView({ block: 'nearest' });
    }
  }
);

watch(
  () => [props.errorMessage, props.statusMessage] as const,
  ([errorMessage, statusMessage]) => {
    if (errorMessage) {
      showToast('error', errorMessage);
      return;
    }

    if (statusMessage) {
      showToast('status', statusMessage);
      return;
    }

    dismissToast();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  clearToastTimer();
});
</script>

<template>
  <aside class="sidebar panel" data-testid="markers-panel">
    <SessionActions
      :is-opening-video="isOpeningVideo"
      @filters-selected="emit('filtersSelected', $event)"
      @open-video="emit('openVideo')"
    />

    <ProcessingOptionsSection
      :can-process-video="canProcessVideo"
      :expanded="isProcessingExpanded"
      :is-opening-video="isOpeningVideo"
      :is-processing="isProcessing"
      :output-path="outputPath"
      :process-button-label="processButtonLabel"
      :process-progress-percent="clampedProcessProgressPercent"
      @process-linked-video="emit('processLinkedVideo')"
      @toggle="toggleProcessingSection"
      @update-output-path="emit('updateOutputPath', $event)"
    />

    <MarkActionTiles
      :pending-start="pendingStart"
      :pending-type="pendingType"
      @select-type="handleMarkTypeRequest"
    />

    <SegmentsSection
      :expanded="isSegmentsExpanded"
      :register-segment-card="registerSegmentCard"
      :segment-issues="segmentIssues"
      :selected-segment-id="selectedSegmentId"
      :sorted-segments="sortedSegments"
      @delete-segment="emit('deleteSegment', $event)"
      @seek="emit('seek', $event)"
      @select-segment="emit('selectSegment', $event)"
      @toggle="toggleSegmentsSection"
      @update-segment="emit('updateSegment', $event)"
    />
  </aside>

  <StatusToast :active-toast="activeToast" @dismiss="dismissToast" />
</template>
