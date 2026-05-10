<script setup lang="ts">
import type { EditableSegment } from '../../../annotator-types';
import { formatTimestamp, parseTimestamp } from '../../../time';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import PhMute from '@phosphor-icons-vue-icons/PhSpeakerSimpleX.vue.mjs';
import PhTrash from '@phosphor-icons-vue-icons/PhTrash.vue.mjs';

const emit = defineEmits<{
  deleteSegment: [id: string];
  seek: [start: number];
  selectSegment: [id: string];
  updateSegment: [payload: { id: string; field: 'start' | 'end'; value: string }];
}>();

const props = defineProps<{
  segment: EditableSegment;
  selected: boolean;
}>();

function formatSegmentType(type: EditableSegment['type']): string {
  return type === 'mute' ? 'MUTE' : 'SKIP';
}

function formatSegmentCategory(segment: EditableSegment): string {
  if (!segment.category) {
    return 'Uncategorized';
  }

  return segment.category.charAt(0).toUpperCase() + segment.category.slice(1);
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

function handleSegmentCard() {
  emit('selectSegment', props.segment.id);
  emit('seek', props.segment.start);
}
</script>

<template>
  <li :class="['segment-card', { 'segment-card-selected': selected }]">
    <div class="segment-card-surface" @click="handleSegmentCard">
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

      <div v-if="segment.source" class="segment-card-imported-meta" data-testid="segment-skp-meta">
        <span v-if="segment.description" class="segment-imported-description">{{ segment.description }}</span>
        <span class="segment-imported-chip">{{ formatSegmentCategory(segment) }}</span>
        <span v-if="segment.severity" class="segment-imported-chip">Severity {{ segment.severity }}</span>
      </div>
    </div>
  </li>
</template>
