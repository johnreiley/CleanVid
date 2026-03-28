<script setup lang="ts">
const emit = defineEmits<{
  export: [];
  filtersSelected: [file: File];
  videoSelected: [file: File];
}>();

defineProps<{
  markerCountLabel: string;
  movieLabel: string;
}>();

function emitSelectedFile(event: Event, type: 'videoSelected' | 'filtersSelected') {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  if (type === 'videoSelected') {
    emit('videoSelected', file);
    return;
  }

  emit('filtersSelected', file);
}
</script>

<template>
  <header class="top-bar" data-testid="top-bar">
    <div class="brand-block">
      <p class="eyebrow">CleanVid Annotator</p>
    </div>

    <div class="top-meta">
      <div class="meta-chip">
        <span class="meta-label">Movie</span>
        <strong>{{ movieLabel }}</strong>
      </div>
      <div class="meta-chip">
        <span class="meta-label">Markers</span>
        <strong>{{ markerCountLabel }}</strong>
      </div>
    </div>

    <div class="top-actions">
      <label class="file-action">
        <span>Load Video</span>
        <input
          data-testid="video-input"
          type="file"
          accept="video/*"
          @change="emitSelectedFile($event, 'videoSelected')"
        />
      </label>

      <label class="file-action">
        <span>Import Filters</span>
        <input
          data-testid="filters-input"
          type="file"
          accept="application/json,.json"
          @change="emitSelectedFile($event, 'filtersSelected')"
        />
      </label>

      <button type="button" class="primary-button" data-testid="export-button" @click="emit('export')">
        Export JSON
      </button>
    </div>
  </header>
</template>
