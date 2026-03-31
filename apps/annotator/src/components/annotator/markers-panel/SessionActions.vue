<script setup lang="ts">
import { computed } from 'vue';

const emit = defineEmits<{
  filtersSelected: [file: File];
  openVideo: [];
}>();

const props = defineProps<{
  canImportFilters: boolean;
  isOpeningVideo: boolean;
  openVideoProgressPercent: number;
}>();

const clampedOpenVideoProgressPercent = computed(() =>
  Math.max(0, Math.min(100, Math.round(props.openVideoProgressPercent)))
);
const openVideoButtonLabel = computed(() =>
  props.isOpeningVideo ? `Importing ${clampedOpenVideoProgressPercent.value}%` : 'Open Video'
);

function emitSelectedFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  emit('filtersSelected', file);
}
</script>

<template>
  <section class="sidebar-section">
    <div class="sidebar-section-heading">
      <h2>Import</h2>
    </div>

    <div class="sidebar-header-row media-action-row">
      <button
        type="button"
        :class="[
          'file-link-button',
          props.isOpeningVideo ? 'process-button process-button-processing' : 'subtle-action'
        ]"
        data-testid="open-video-button"
        :disabled="props.isOpeningVideo"
        :aria-valuenow="props.isOpeningVideo ? clampedOpenVideoProgressPercent : undefined"
        aria-valuemin="0"
        aria-valuemax="100"
        @click="emit('openVideo')"
      >
        <span
          v-if="props.isOpeningVideo"
          class="process-button-progress"
          data-testid="open-video-progress-fill"
          :style="{ width: `${clampedOpenVideoProgressPercent}%` }"
        />
        <span class="process-button-copy">{{ openVideoButtonLabel }}</span>
      </button>

      <label :class="['subtle-action', { 'subtle-action-disabled': !props.canImportFilters }]">
        <span>Import Filters</span>
        <input
          data-testid="filters-input"
          class="visually-hidden-input"
          type="file"
          accept="application/json,.json,.skp"
          :disabled="!props.canImportFilters"
          @change="emitSelectedFile"
        />
      </label>
    </div>
  </section>
</template>
