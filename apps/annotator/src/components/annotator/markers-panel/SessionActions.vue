<script setup lang="ts">
const emit = defineEmits<{
  filtersSelected: [file: File];
  openVideo: [];
}>();

defineProps<{
  isOpeningVideo: boolean;
}>();

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
  <div class="sidebar-header">
    <p class="eyebrow">Session</p>

    <div class="sidebar-header-row">
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
</template>
