<script setup lang="ts">
import type { SkpDraftSegment } from '@cleanvid/shared';

const emit = defineEmits<{
  apply: [];
  close: [];
  discard: [];
  seek: [start: number];
}>();

defineProps<{
  showCloseButton?: boolean;
  draftCountLabel: string;
  summaryText: string;
  segments: SkpDraftSegment[];
  warnings: string[];
}>();

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const wholeSeconds = Math.floor(safeSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  const milliseconds = Math.round((safeSeconds - wholeSeconds) * 1000);

  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function formatFilterType(type: SkpDraftSegment['type']): string {
  return type === 'mute' ? 'Mute' : 'Skip';
}

function formatCategory(category: SkpDraftSegment['category']): string {
  if (category === null) {
    return 'Uncategorized';
  }

  return category.charAt(0).toUpperCase() + category.slice(1);
}
</script>

<template>
  <section class="sidebar-section skp-import-section" data-testid="skp-import-section">
    <div class="sidebar-section-heading">
      <h2>Review SKP Import</h2>
      <button
        v-if="showCloseButton"
        type="button"
        class="subtle-action profanity-modal-close-button"
        data-testid="close-skp-import-button"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <div class="profanity-capability-notice" data-testid="skp-import-summary">
      <p>{{ summaryText }}</p>
      <p>Review the imported segments before replacing the current filter timeline.</p>
    </div>

    <div v-if="warnings.length > 0" class="validation-summary" data-testid="skp-import-warnings">
      <strong>{{ warnings.length }} skipped entr{{ warnings.length === 1 ? 'y' : 'ies' }}</strong>
      <ul>
        <li v-for="warning in warnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
    </div>

    <div class="export-metric-row">
      <span>Draft imports</span>
      <strong data-testid="skp-draft-count">{{ draftCountLabel }}</strong>
    </div>

    <div v-if="segments.length === 0" class="segments-empty">
      <p>No draft SKP entries ready to review</p>
    </div>

    <ul v-else class="segment-list profanity-suggestion-list" data-testid="skp-draft-list">
      <li
        v-for="segment in segments"
        :key="segment.id"
        class="segment-card profanity-suggestion-card"
      >
        <button
          type="button"
          class="segment-card-surface profanity-suggestion-surface"
          data-testid="skp-draft-seek"
          @click="emit('seek', segment.start)"
        >
          <div class="segment-card-top">
            <div class="segment-card-type">
              <span :class="['segment-type-label', `segment-type-label-${segment.type}`]">
                {{ formatFilterType(segment.type) }}
              </span>
            </div>
            <div class="segment-card-meta">
              <span class="segment-duration">Severity {{ segment.severity }}</span>
            </div>
          </div>
          <div class="segment-time-row">
            <span>{{ formatTimestamp(segment.start) }}</span>
            <span class="segment-range-separator">-&gt;</span>
            <span>{{ formatTimestamp(segment.end) }}</span>
          </div>
          <div class="profanity-suggestion-snippet" data-testid="skp-draft-description" :title="segment.description">
            {{ segment.description }}
          </div>
          <div class="segment-duration" data-testid="skp-draft-category">
            {{ formatCategory(segment.category) }}
          </div>
        </button>
      </li>
    </ul>

    <div class="media-action-row">
      <button
        type="button"
        class="subtle-action"
        data-testid="apply-skp-import-button"
        :disabled="segments.length === 0"
        @click="emit('apply')"
      >
        Apply imported SKP filters
      </button>

      <button
        type="button"
        class="subtle-action"
        data-testid="discard-skp-import-button"
        :disabled="segments.length === 0"
        @click="emit('discard')"
      >
        Discard import
      </button>
    </div>
  </section>
</template>
