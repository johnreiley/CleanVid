<script setup lang="ts">
import PhExport from '@phosphor-icons-vue-icons/PhUploadSimple.vue.mjs';
import PhLightning from '@phosphor-icons-vue-icons/PhLightning.vue.mjs';

defineEmits<{
  export: [];
}>();

defineProps<{
  markerCountLabel: string;
  movieLabel: string;
}>();
</script>

<template>
  <header class="top-bar" data-testid="top-bar">
    <div class="brand-lockup">
      <div class="brand-mark">
        <PhLightning :size="18" weight="fill" />
      </div>
      <div class="brand-copy">
        <strong>CleanVid</strong>
        <span>.studio</span>
      </div>
    </div>

    <div class="top-bar-meta">
      <span class="meta-chip">{{ markerCountLabel }}</span>
      <button type="button" class="export-button" data-testid="export-button" @click="$emit('export')">
        <PhExport :size="18" />
        <span>Export Sequence</span>
      </button>
    </div>
  </header>
</template>
