<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import type { EditableSegment, SegmentIssue } from '../../../annotator-types';
import MarkActionTiles from './MarkActionTiles.vue';
import ProcessingOptionsSection from './ProcessingOptionsSection.vue';
import SegmentsSection from './SegmentsSection.vue';
import SessionActions from './SessionActions.vue';
import SidebarModeTabs from './SidebarModeTabs.vue';
import StatusToast from './StatusToast.vue';

type AnnotatorUiMode = 'media' | 'annotate' | 'export';

const emit = defineEmits<{
  activeTypeChange: [value: FilterType];
  changeMode: [value: AnnotatorUiMode];
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
  currentMode: AnnotatorUiMode;
  errorMessage: string;
  inputName: string;
  isOpeningVideo: boolean;
  isProcessing: boolean;
  markerCountLabel: string;
  outputPath: string;
  playbackSourceLabel: string;
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
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const clampedProcessProgressPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(props.processProgressPercent)))
);
const processButtonLabel = computed(() =>
  props.isProcessing ? `Exporting ${clampedProcessProgressPercent.value}%` : 'Export Video'
);
const hasLoadedVideo = computed(() => props.inputName !== '');
const mediaStatusCopy = computed(() => {
  if (!hasLoadedVideo.value) {
    return 'Open a local video file or import a filter file to start a session.';
  }

  return props.playbackSourceLabel || 'Media ready for annotation.';
});
const exportReadinessCopy = computed(() => {
  if (props.isProcessing) {
    return 'Export is running. Progress updates will appear here and in the status toast.';
  }

  if (props.canProcessVideo) {
    return 'Ready to render the cleaned output using the current filters.';
  }

  if (!hasLoadedVideo.value) {
    return 'Load a source video before exporting.';
  }

  return 'Resolve validation issues before processing the current output.';
});
const pendingModeLabel = computed(() => (props.pendingType === 'mute' ? 'Mute' : 'Skip'));

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
    <div class="sidebar-intro">
      <p class="eyebrow">Workspace</p>
      <div class="sidebar-intro-copy">
        <strong>Editor Console</strong>
        <span>{{ inputName || 'Load source media to begin.' }}</span>
      </div>
    </div>

    <SidebarModeTabs :current-mode="currentMode" @change-mode="emit('changeMode', $event)" />

    <div v-if="currentMode === 'media'" class="sidebar-mode-panel" data-testid="mode-panel-media">
      <SessionActions
        :is-opening-video="isOpeningVideo"
        @filters-selected="emit('filtersSelected', $event)"
        @open-video="emit('openVideo')"
      />

      <section class="mode-summary-panel">
        <div class="panel-heading">
          <div>
            <p class="section-kicker">Current Media</p>
            <h2>Session Setup</h2>
          </div>
          <span class="panel-count">{{ markerCountLabel }}</span>
        </div>

        <div class="session-summary-card">
          <strong>{{ inputName || 'No file loaded' }}</strong>
          <span>{{ mediaStatusCopy }}</span>
        </div>

        <div class="compact-metric-grid">
          <div class="compact-metric-card">
            <span class="compact-metric-label">Output</span>
            <strong>{{ outputPath || 'Auto-generated after opening a video' }}</strong>
          </div>
          <div class="compact-metric-card">
            <span class="compact-metric-label">Status</span>
            <strong>{{ statusMessage }}</strong>
          </div>
        </div>
      </section>
    </div>

    <div
      v-else-if="currentMode === 'annotate'"
      class="sidebar-mode-panel sidebar-mode-panel-annotate"
      data-testid="mode-panel-annotate"
    >
      <div class="mode-section-header">
        <div>
          <p class="section-kicker">Annotate</p>
          <h2>Timeline Editing</h2>
        </div>
        <span class="panel-count">{{ markerCountLabel }}</span>
      </div>

      <div class="annotate-summary-bar">
        <span class="compact-mode-chip">{{ inputName || 'No file loaded' }}</span>
        <span class="compact-mode-chip">
          {{ pendingType !== null && pendingStart !== null ? `${pendingModeLabel} live` : 'Ready to mark' }}
        </span>
      </div>

      <MarkActionTiles
        :pending-start="pendingStart"
        :pending-type="pendingType"
        @select-type="handleMarkTypeRequest"
      />

      <SegmentsSection
        :register-segment-card="registerSegmentCard"
        :segment-issues="segmentIssues"
        :selected-segment-id="selectedSegmentId"
        :sorted-segments="sortedSegments"
        @delete-segment="emit('deleteSegment', $event)"
        @seek="emit('seek', $event)"
        @select-segment="emit('selectSegment', $event)"
        @update-segment="emit('updateSegment', $event)"
      />
    </div>

    <div v-else class="sidebar-mode-panel sidebar-mode-panel-export" data-testid="mode-panel-export">
      <div class="mode-section-header">
        <div>
          <p class="section-kicker">Export</p>
          <h2>Output Console</h2>
        </div>
        <span class="panel-count">{{ markerCountLabel }}</span>
      </div>

      <div class="session-summary-card">
        <strong>{{ inputName || 'No source video loaded' }}</strong>
        <span>{{ exportReadinessCopy }}</span>
      </div>

      <ProcessingOptionsSection
        :can-process-video="canProcessVideo"
        :input-name="inputName"
        :is-opening-video="isOpeningVideo"
        :is-processing="isProcessing"
        :marker-count-label="markerCountLabel"
        :output-path="outputPath"
        :process-button-label="processButtonLabel"
        :process-progress-percent="clampedProcessProgressPercent"
        @process-linked-video="emit('processLinkedVideo')"
        @update-output-path="emit('updateOutputPath', $event)"
      />
    </div>
  </aside>

  <StatusToast :active-toast="activeToast" @dismiss="dismissToast" />
</template>
