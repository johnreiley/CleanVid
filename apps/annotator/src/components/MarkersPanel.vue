<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import type { FilterType } from '@cleanvid/shared';
import type { EditableSegment, SegmentIssue } from '../annotator-types';
import { formatTimestamp, parseTimestamp } from '../time';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import PhInfo from '@phosphor-icons-vue-icons/PhInfo.vue.mjs';
import PhMute from '@phosphor-icons-vue-icons/PhSpeakerSimpleX.vue.mjs';
import PhTrash from '@phosphor-icons-vue-icons/PhTrash.vue.mjs';
import PhX from '@phosphor-icons-vue-icons/PhX.vue.mjs';
import PhWind from '@phosphor-icons-vue-icons/PhWind.vue.mjs';

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

function emitSelectedFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  emit('filtersSelected', file);
}

function formatSegmentType(type: FilterType): string {
  return type === 'mute' ? 'MUTE' : 'SKIP';
}

function formatDuration(segment: EditableSegment): string {
  return `${Math.max(0, segment.end - segment.start).toFixed(1)}s`;
}

function readEditableText(target: EventTarget | null): string {
  if (!(target instanceof HTMLElement)) {
    return '';
  }

  return (target.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function resetEditableText(target: EventTarget | null, value: string) {
  if (target instanceof HTMLElement) {
    target.textContent = value;
  }
}

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

function toggleProcessingSection() {
  isProcessingExpanded.value = !isProcessingExpanded.value;
}

function toggleSegmentsSection() {
  isSegmentsExpanded.value = !isSegmentsExpanded.value;
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

function commitSegmentTime(segment: EditableSegment, field: 'start' | 'end', event: FocusEvent) {
  const parsed = parseTimestamp(readEditableText(event.target));

  if (parsed === null) {
    resetEditableText(event.target, formatTimestamp(segment[field]));
    return;
  }

  emit('updateSegment', {
    id: segment.id,
    field,
    value: parsed.toString()
  });
  resetEditableText(event.target, formatTimestamp(parsed));
}

function handleSegmentCard(segment: EditableSegment) {
  emit('selectSegment', segment.id);
  emit('seek', segment.start);
}

function setActiveType(type: FilterType) {
  emit('activeTypeChange', type);
  emit('toggleMark', type);
}

function hasSelectedSegment(id: string): boolean {
  return props.selectedSegmentId === id;
}

function isMarking(type: FilterType): boolean {
  return props.pendingType === type && props.pendingStart !== null;
}

function handleEditableKeydown(event: KeyboardEvent, fallbackValue: string) {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    event.target.blur();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    resetEditableText(event.target, fallbackValue);
    event.target.blur();
  }
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
    <div class="sidebar-header">
      <p class="eyebrow">Session</p>
      <div class="sidebar-header-row">
        <!-- <span class="meta-chip">{{ markerCountLabel }}</span> -->
        <button
          type="button"
          class="subtle-action file-link-button"
          data-testid="open-video-button"
          :disabled="isOpeningVideo"
          @click="emit('openVideo')"
        >
          {{ isOpeningVideo ? 'Preparing...' : 'Open Video' }}
        </button>
        <label class="subtle-action">
          <span>Import Filters</span>
          <input
            data-testid="filters-input"
            class="visually-hidden-input"
            type="file"
            accept="application/json,.json"
            @change="emitSelectedFile"
          />
        </label>
      </div>
    </div>

    <section class="file-actions">
      <div class="panel-heading file-actions-heading">
        <div>
          <p class="section-kicker">Export</p>
          <h2>Options</h2>
        </div>
        <button
          type="button"
          class="section-toggle-button"
          data-testid="toggle-processing-section"
          :aria-expanded="isProcessingExpanded"
          @click="toggleProcessingSection"
        >
          {{ isProcessingExpanded ? 'Hide' : 'Show' }}
        </button>
      </div>

      <div
        v-if="isProcessingExpanded"
        class="collapsible-section-content"
        data-testid="processing-section-content"
      >
        <p class="file-link-empty">Processing always uses the original source file, not the preview.</p>

        <label class="file-path-field">
          <span class="field-label-with-tooltip">
            <span>Output path</span>
            <span class="field-tooltip">
              <button
                type="button"
                class="field-tooltip-button"
                aria-label="Explain output path"
              >
                <PhInfo :size="18" weight="fill" />
              </button>
              <span class="field-tooltip-content" role="tooltip">
                Defaults to the same directory as the opened video
              </span>
            </span>
          </span>
          <input
            data-testid="output-path-input"
            class="file-path-input"
            type="text"
            placeholder="C:\example\filepath"
            :value="outputPath"
            @input="emit('updateOutputPath', ($event.target as HTMLInputElement).value)"
          />
        </label>

        <button
          type="button"
          :class="['process-button', { 'process-button-processing': isProcessing }]"
          data-testid="process-video-button"
          :disabled="!canProcessVideo || isOpeningVideo"
          :aria-valuenow="isProcessing ? clampedProcessProgressPercent : undefined"
          aria-valuemin="0"
          aria-valuemax="100"
          @click="emit('processLinkedVideo')"
        >
          <span
            v-if="isProcessing"
            class="process-button-progress"
            data-testid="process-progress-fill"
            :style="{ width: `${clampedProcessProgressPercent}%` }"
          />
          <span class="process-button-copy">{{ processButtonLabel }}</span>
        </button>
      </div>
    </section>

    <section class="quick-actions">
      <button
        type="button"
        :class="['action-tile', 'action-tile-mute', { 'action-tile-active': isMarking('mute') }]"
        data-testid="toggle-mute"
        @click="setActiveType('mute')"
      >
        <span class="action-glyph">
          <PhMute :size="28" weight="bold" />
        </span>
        <span class="action-copy">
          <strong>Mute Range</strong>
          <span class="action-subtext">Hotkey [M]</span>
        </span>
      </button>

      <button
        type="button"
        :class="['action-tile', 'action-tile-skip', { 'action-tile-active': isMarking('skip') }]"
        data-testid="toggle-skip"
        @click="setActiveType('skip')"
      >
        <span class="action-glyph">
          <PhSkipForward :size="28" weight="bold" />
        </span>
        <span class="action-copy">
          <strong>Skip Range</strong>
          <span class="action-subtext">Hotkey [S]</span>
        </span>
      </button>
    </section>

    <section class="segments-shell">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">Filters</p>
          <h2>Timeline</h2>
        </div>
        <div class="section-heading-actions">
          <span class="panel-count">{{ sortedSegments.length.toString().padStart(2, '0') }}</span>
          <button
            type="button"
            class="section-toggle-button"
            data-testid="toggle-segments-section"
            :aria-expanded="isSegmentsExpanded"
            @click="toggleSegmentsSection"
          >
            {{ isSegmentsExpanded ? 'Hide' : 'Show' }}
          </button>
        </div>
      </div>

      <div
        v-if="isSegmentsExpanded"
        class="collapsible-section-content collapsible-section-content-grow"
        data-testid="segments-section-content"
      >
        <div v-if="segmentIssues.length > 0" class="validation-summary" data-testid="validation-summary">
          <strong>{{ segmentIssues.length }} issue{{ segmentIssues.length === 1 ? '' : 's' }}</strong>
          <ul>
            <li v-for="issue in segmentIssues" :key="issue.id">
              {{ issue.id }}: {{ issue.messages.join(' ') }}
            </li>
          </ul>
        </div>

        <div v-if="sortedSegments.length === 0" class="segments-empty">
          <PhWind :size="32" />
          <p>Timeline is empty</p>
        </div>

        <ul v-else class="segment-list" data-testid="segment-list">
          <li
            v-for="segment in sortedSegments"
            :key="segment.id"
            :ref="(element) => registerSegmentCard(segment.id, element)"
            :class="['segment-card', { 'segment-card-selected': hasSelectedSegment(segment.id) }]"
          >
            <div class="segment-card-surface" @click="handleSegmentCard(segment)">
              <div class="segment-card-top">
                <div :class="['segment-card-type', `segment-card-type-${segment.type}`]">
                  <span class="segment-type-glyph">
                    <PhMute v-if="segment.type === 'mute'" :size="14" weight="bold" />
                    <PhSkipForward v-else :size="14" weight="bold" />
                  </span>
                  <span :class="['segment-type-label', `segment-type-label-${segment.type}`]">
                    {{ formatSegmentType(segment.type) }}
                  </span>
                </div>
                <button
                  type="button"
                  class="segment-delete-button"
                  data-testid="segment-delete"
                  aria-label="Delete segment"
                  title="Delete segment"
                  @click.stop="emit('deleteSegment', segment.id)"
                >
                  <PhTrash :size="16" />
                </button>
              </div>

              <div class="segment-time-row">
                <span
                  class="segment-editable-time"
                  data-testid="segment-start-edit"
                  contenteditable="true"
                  spellcheck="false"
                  role="textbox"
                  tabindex="0"
                  @click.stop
                  @focus="emit('selectSegment', segment.id)"
                  @blur="commitSegmentTime(segment, 'start', $event)"
                  @keydown="handleEditableKeydown($event, formatTimestamp(segment.start))"
                >
                  {{ formatTimestamp(segment.start) }}
                </span>
                <span class="segment-range-separator">-&gt;</span>
                <span
                  class="segment-editable-time"
                  data-testid="segment-end-edit"
                  contenteditable="true"
                  spellcheck="false"
                  role="textbox"
                  tabindex="0"
                  @click.stop
                  @focus="emit('selectSegment', segment.id)"
                  @blur="commitSegmentTime(segment, 'end', $event)"
                  @keydown="handleEditableKeydown($event, formatTimestamp(segment.end))"
                >
                  {{ formatTimestamp(segment.end) }}
                </span>
              </div>

              <div class="segment-card-meta">
                <span class="segment-duration">{{ formatDuration(segment) }}</span>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </aside>

  <div class="toast-stack" aria-live="polite" aria-atomic="true">
    <Transition name="toast" appear>
      <div
        v-if="activeToast"
        :key="activeToast.key"
        :class="[
          'feedback-card',
          'feedback-toast',
          activeToast.kind === 'error' ? 'feedback-card-error' : 'feedback-card-quiet'
        ]"
        :data-testid="activeToast.kind === 'error' ? 'error-message' : 'status-message'"
      >
        <span class="feedback-toast-copy">{{ activeToast.message }}</span>
        <button
          type="button"
          class="toast-dismiss-button"
          data-testid="toast-dismiss"
          aria-label="Dismiss notification"
          title="Dismiss notification"
          @click="dismissToast"
        >
          <PhX :size="14" />
        </button>
      </div>
    </Transition>
  </div>
</template>
