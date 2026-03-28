<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import type { EditableSegment, SegmentIssue } from '../annotator-types';
import { formatTimestamp } from '../time';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import PhMute from '@phosphor-icons-vue-icons/PhSpeakerSimpleX.vue.mjs';

const emit = defineEmits<{
  activeTypeChange: [value: FilterType];
  deleteSegment: [id: string];
  filtersSelected: [file: File];
  seek: [start: number];
  selectSegment: [id: string | null];
  toggleMark: [value: FilterType];
  updateSegment: [payload: { id: string; field: 'start' | 'end'; value: string }];
  updateSegmentType: [payload: { id: string; value: FilterType }];
}>();

const props = defineProps<{
  activeType: FilterType;
  errorMessage: string;
  markerCountLabel: string;
  pendingStart: number | null;
  pendingType: FilterType | null;
  pendingTypeLabel: string;
  segmentIssues: SegmentIssue[];
  selectedSegmentId: string | null;
  sortedSegments: EditableSegment[];
  statusMessage: string;
}>();

function emitSelectedFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  emit('filtersSelected', file);
}

function formatSegmentType(type: FilterType): string {
  return type === 'mute' ? 'Mute' : 'Skip';
}

function formatDuration(segment: EditableSegment): string {
  return `${Math.max(0, segment.end - segment.start).toFixed(1)}s`;
}

function emitSegmentType(id: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value;

  if (value !== 'mute' && value !== 'skip') {
    return;
  }

  emit('updateSegmentType', { id, value });
}

function emitSegmentNumber(id: string, field: 'start' | 'end', event: Event) {
  emit('updateSegment', {
    id,
    field,
    value: (event.target as HTMLInputElement).value
  });
}

function handleSegmentCard(segment: EditableSegment) {
  emit('selectSegment', segment.id);
  emit('seek', segment.start);
}

function closeSelectedSegment() {
  emit('selectSegment', null);
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

    <p v-if="errorMessage" class="feedback-card feedback-card-error" data-testid="error-message">
      {{ errorMessage }}
    </p>
    <p v-else class="feedback-card feedback-card-quiet" data-testid="status-message">
      {{ statusMessage }}
    </p>

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

      <ul v-else class="segment-list" data-testid="segment-list">
        <li
          v-for="segment in sortedSegments"
          :key="segment.id"
          :class="['segment-card', { 'segment-card-selected': hasSelectedSegment(segment.id) }]"
        >
          <button type="button" class="segment-card-button" @click="handleSegmentCard(segment)">
            <div class="segment-card-main">
              <span :class="['type-pill', `type-pill-${segment.type}`]">{{ formatSegmentType(segment.type) }}</span>
              <span class="segment-duration">{{ formatDuration(segment) }}</span>
            </div>
            <strong class="segment-time">{{ formatTimestamp(segment.start) }} -> {{ formatTimestamp(segment.end) }}</strong>
          </button>

          <div class="segment-card-footer">
            <span class="segment-id">{{ segment.id }}</span>
            <div class="segment-actions">
              <button
                v-if="hasSelectedSegment(segment.id)"
                type="button"
                class="text-button"
                @click="closeSelectedSegment"
              >
                Done
              </button>
              <button
                v-else
                type="button"
                class="text-button"
                @click="emit('selectSegment', segment.id)"
              >
                Edit
              </button>
              <button type="button" class="text-button text-button-danger" @click="emit('deleteSegment', segment.id)">
                Remove
              </button>
            </div>
          </div>

          <div v-if="hasSelectedSegment(segment.id)" class="detail-grid">
            <label class="field">
              <span>Type</span>
              <select :value="segment.type" @change="emitSegmentType(segment.id, $event)">
                <option value="mute">Mute</option>
                <option value="skip">Skip</option>
              </select>
            </label>

            <label class="field">
              <span>Start</span>
              <input
                :value="Number.isFinite(segment.start) ? segment.start : ''"
                type="number"
                step="0.1"
                @input="emitSegmentNumber(segment.id, 'start', $event)"
              />
            </label>

            <label class="field">
              <span>End</span>
              <input
                :value="Number.isFinite(segment.end) ? segment.end : ''"
                type="number"
                step="0.1"
                @input="emitSegmentNumber(segment.id, 'end', $event)"
              />
            </label>
          </div>
        </li>
      </ul>
    </section>
  </aside>
</template>
