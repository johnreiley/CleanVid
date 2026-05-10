<script setup lang="ts">
import type { FiltersObjectCategory, FiltersObjectTag } from '@cleanvid/shared';
import { computed } from 'vue';
import FiltersObjectCategoryNode from './FiltersObjectCategoryNode.vue';

export type FiltersObjectImportMode = 'replace' | 'append';

const emit = defineEmits<{
  apply: [];
  close: [];
  discard: [];
  toggleCategory: [payload: { ids: string[]; selected: boolean }];
  toggleTag: [payload: { id: string; selected: boolean }];
  updateMode: [value: FiltersObjectImportMode];
}>();

const props = defineProps<{
  categories: FiltersObjectCategory[];
  duration: number;
  importMode: FiltersObjectImportMode;
  selectedCountLabel: string;
  selectedTagIds: string[];
  showCloseButton?: boolean;
  summaryText: string;
  tagCountLabel: string;
  tags: FiltersObjectTag[];
  warnings: string[];
}>();

const selectedTagIdSet = computed(() => new Set(props.selectedTagIds));
const selectedTags = computed(() => props.tags.filter((tag) => selectedTagIdSet.value.has(tag.id)));

function getPreviewMarkerStyle(tag: FiltersObjectTag) {
  const duration = Math.max(props.duration, tag.end, 1);
  const left = Math.max(0, Math.min(100, (tag.start / duration) * 100));
  const width = Math.max(0.18, ((tag.end - tag.start) / duration) * 100);

  return {
    left: `${left}%`,
    width: `${Math.min(width, 100 - left)}%`
  };
}
</script>

<template>
  <section class="sidebar-section filters-object-import-section" data-testid="filters-object-import-section">
    <div class="sidebar-section-heading">
      <h2>Review Filters Object</h2>
      <button
        v-if="showCloseButton"
        type="button"
        class="subtle-action profanity-modal-close-button"
        data-testid="close-filters-object-import-button"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <div class="profanity-capability-notice" data-testid="filters-object-import-summary">
      <p>{{ summaryText }}</p>
      <p>Select categories or tags before applying them to the current movie.</p>
    </div>

    <div v-if="warnings.length > 0" class="validation-summary" data-testid="filters-object-import-warnings">
      <strong>{{ warnings.length }} skipped tag{{ warnings.length === 1 ? '' : 's' }}</strong>
      <ul>
        <li v-for="warning in warnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
    </div>

    <div class="filters-object-import-metrics">
      <div class="export-metric-row">
        <span>Usable tags</span>
        <strong data-testid="filters-object-tag-count">{{ tagCountLabel }}</strong>
      </div>
      <div class="export-metric-row">
        <span>Selected</span>
        <strong data-testid="filters-object-selected-count">{{ selectedCountLabel }}</strong>
      </div>
    </div>

    <label class="svg-import-field">
      <span>Import mode</span>
      <select
        class="svg-import-select"
        data-testid="filters-object-import-mode-select"
        :value="importMode"
        @change="emit('updateMode', ($event.target as HTMLSelectElement).value as FiltersObjectImportMode)"
      >
        <option value="replace">Replace current timeline</option>
        <option value="append">Append to current timeline</option>
      </select>
    </label>

    <div class="filters-object-preview" data-testid="filters-object-preview">
      <div class="filters-object-preview-heading">
        <span>Selected preview</span>
        <span>White mute, black skip</span>
      </div>
      <div class="filters-object-preview-track">
        <span
          v-for="tag in selectedTags"
          :key="tag.id"
          :class="[
            'filters-object-preview-marker',
            tag.sourceType === 'audio'
              ? 'filters-object-preview-marker-audio'
              : 'filters-object-preview-marker-audiovisual'
          ]"
          data-testid="filters-object-preview-marker"
          :style="getPreviewMarkerStyle(tag)"
          :title="`${tag.description} ${tag.start.toFixed(2)}s-${tag.end.toFixed(2)}s`"
        />
      </div>
    </div>

    <div class="filters-object-category-tree" data-testid="filters-object-category-tree">
      <FiltersObjectCategoryNode
        v-for="category in categories"
        :key="category.id"
        :category="category"
        :selected-tag-ids="selectedTagIds"
        @toggle-category="emit('toggleCategory', $event)"
        @toggle-tag="emit('toggleTag', $event)"
      />
    </div>

    <div class="media-action-row">
      <button
        type="button"
        class="subtle-action"
        data-testid="apply-filters-object-import-button"
        :disabled="selectedTags.length === 0"
        @click="emit('apply')"
      >
        Apply selected filters
      </button>

      <button
        type="button"
        class="subtle-action"
        data-testid="discard-filters-object-import-button"
        @click="emit('discard')"
      >
        Discard import
      </button>
    </div>
  </section>
</template>
