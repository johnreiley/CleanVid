<script setup lang="ts">
import PhExport from '@phosphor-icons-vue-icons/PhUploadSimple.vue.mjs';
// import PhLightning from '@phosphor-icons-vue-icons/PhLightning.vue.mjs';
import PhSprayBottle from '@phosphor-icons-vue-icons/PhSprayBottle.vue.mjs';

defineEmits<{
  export: [];
}>();

defineProps<{
  movieLabel: string;
}>();
</script>

<template>
  <header class="top-bar" data-testid="top-bar">
    <div class="brand-lockup">
      <div class="brand-mark">
        <PhSprayBottle :size="24" weight="fill" mirrored />
      </div>
      <div class="brand-copy">
        <strong>CleanVid</strong>
        <span>.studio</span>
      </div>
    </div>

    <div class="top-bar-meta">
      <div class="meta-chip meta-chip-filename" :title="movieLabel">{{ movieLabel }}</div>
      <button type="button" class="export-button" data-testid="export-button" @click="$emit('export')">
        <PhExport :size="18" />
        <span>Export Filters</span>
      </button>
    </div>
  </header>
</template>
