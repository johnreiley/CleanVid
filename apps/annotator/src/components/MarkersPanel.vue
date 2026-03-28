<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import type { FilterType } from '@cleanvid/shared';
import type { EditableSegment, SegmentIssue } from '../annotator-types';
import { formatTimestamp, parseTimestamp } from '../time';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import PhMute from '@phosphor-icons-vue-icons/PhSpeakerSimpleX.vue.mjs';
import PhTrash from '@phosphor-icons-vue-icons/PhTrash.vue.mjs';
import PhX from '@phosphor-icons-vue-icons/PhX.vue.mjs';

const emit = defineEmits<{
  activeTypeChange: [value: FilterType];
  deleteSegment: [id: string];
  filtersSelected: [file: File];
  seek: [start: number];
  selectSegment: [id: string | null];
  toggleMark: [value: FilterType];
  updateSegment: [payload: { id: string; field: 'start' | 'end'; value: string }];
}>();

const props = defineProps<{
  activeType: FilterType;
  errorMessage: string;
  markerCountLabel: string;
  pendingStart: number | null;
  pendingType: FilterType | null;
  pendingTypeLabel: string;
  selectionScrollKey: number;
  segmentIssues: SegmentIssue[];
  selectedSegmentId: string | null;
  sortedSegments: EditableSegment[];
  statusMessage: string;
}>();

const segmentList = ref<HTMLElement | null>(null);
const segmentCards = new Map<string, HTMLElement>();
const activeToast = ref<{ kind: 'error' | 'status'; message: string; key: string } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

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
  () => props.sortedSegments.length,
  async (nextLength, previousLength) => {
    if (nextLength === 0 || nextLength <= previousLength) {
      return;
    }

    await nextTick();

    if (segmentList.value) {
      segmentList.value.scrollTop = segmentList.value.scrollHeight;
    }
  }
);

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
        <span class="meta-chip">{{ markerCountLabel }}</span>
        <label class="subtle-action">
          <span>Import JSON</span>
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

    <section class="quick-actions">
      <button
        type="button"
        :class="['action-tile', 'action-tile-mute', { 'action-tile-active': isMarking('mute') || activeType === 'mute' }]"
        data-testid="toggle-mute"
        @click="setActiveType('mute')"
      >
        <span class="action-glyph">
          <PhMute :size="20" weight="bold" />
        </span>
        <span class="action-copy">
          <strong>Mute Segment</strong>
          <span>{{ isMarking('mute') ? 'Close active mute range' : 'Hotkey [M]' }}</span>
        </span>
        <span class="action-plus">{{ isMarking('mute') ? '•' : '+' }}</span>
      </button>

      <button
        type="button"
        :class="['action-tile', 'action-tile-skip', { 'action-tile-active': isMarking('skip') || activeType === 'skip' }]"
        data-testid="toggle-skip"
        @click="setActiveType('skip')"
      >
        <span class="action-glyph">
          <PhSkipForward :size="20" weight="bold" />
        </span>
        <span class="action-copy">
          <strong>Skip Segment</strong>
          <span>{{ isMarking('skip') ? 'Close active skip range' : 'Hotkey [S]' }}</span>
        </span>
        <span class="action-plus">{{ isMarking('skip') ? '•' : '+' }}</span>
      </button>
    </section>

    <div
      v-if="pendingStart !== null && pendingType !== null"
      class="marking-indicator"
      data-testid="marking-indicator"
    >
      <span :class="['marking-pulse', `marking-pulse-${pendingType}`]" />
      <div>
        <strong>{{ pendingTypeLabel }} marking live</strong>
        <p>{{ formatTimestamp(pendingStart) }} captured. Press {{ pendingType === 'mute' ? 'M' : 'S' }} again to commit.</p>
      </div>
    </div>

    <section class="segments-shell">
      <div class="panel-heading">
        <div>
          <p class="section-kicker">Segments</p>
          <h2>Timeline</h2>
        </div>
        <span class="panel-count">{{ sortedSegments.length.toString().padStart(2, '0') }}</span>
      </div>

      <div v-if="segmentIssues.length > 0" class="validation-summary" data-testid="validation-summary">
        <strong>{{ segmentIssues.length }} issue{{ segmentIssues.length === 1 ? '' : 's' }}</strong>
        <ul>
          <li v-for="issue in segmentIssues" :key="issue.id">
            {{ issue.id }}: {{ issue.messages.join(' ') }}
          </li>
        </ul>
      </div>

      <div v-if="sortedSegments.length === 0" class="segments-empty">
        <div class="empty-stack" />
        <p>Timeline is empty</p>
      </div>

      <ul v-else ref="segmentList" class="segment-list" data-testid="segment-list">
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
