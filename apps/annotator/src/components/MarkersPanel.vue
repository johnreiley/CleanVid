<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import type { EditableSegment, SegmentIssue } from '../annotator-types';
import { formatTimestamp } from '../time';

const emit = defineEmits<{
  deleteSegment: [id: string];
  seek: [start: number];
  updateSegment: [payload: { id: string; field: 'start' | 'end'; value: string }];
  updateSegmentType: [payload: { id: string; value: FilterType }];
}>();

defineProps<{
  segmentIssues: SegmentIssue[];
  sortedSegments: EditableSegment[];
}>();

function formatSegmentType(type: FilterType): string {
  return type === 'mute' ? 'Mute' : 'Skip';
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
</script>

<template>
  <section class="markers-panel panel" data-testid="markers-panel">
    <div class="panel-heading">
      <div>
        <p class="section-kicker">Markers</p>
        <h2>Existing segments</h2>
      </div>
      <span class="panel-count">{{ sortedSegments.length }} total</span>
    </div>

    <p v-if="sortedSegments.length === 0" class="empty-state">
      No segments yet. Load a video, choose a type, then mark start and end points.
    </p>

    <ul v-else class="segment-list" data-testid="segment-list">
      <li v-for="segment in sortedSegments" :key="segment.id" class="segment-card">
        <div class="segment-summary">
          <div class="segment-summary-main">
            <span :class="['type-pill', `type-pill-${segment.type}`]">{{ formatSegmentType(segment.type) }}</span>
            <button type="button" class="segment-link" @click="emit('seek', segment.start)">
              {{ formatTimestamp(segment.start) }} - {{ formatTimestamp(segment.end) }}
            </button>
          </div>
          <span class="segment-id">{{ segment.id }}</span>
        </div>

        <div class="segment-grid">
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

          <button type="button" class="danger-button" @click="emit('deleteSegment', segment.id)">Delete</button>
        </div>
      </li>
    </ul>

    <div v-if="segmentIssues.length > 0" class="validation-list">
      <h3>Validation Issues</h3>
      <ul>
        <li v-for="issue in segmentIssues" :key="issue.id">
          {{ issue.id }}: {{ issue.messages.join(' ') }}
        </li>
      </ul>
    </div>
  </section>
</template>
