<script setup lang="ts">
type AnnotatorUiMode = 'media' | 'annotate' | 'export';

const emit = defineEmits<{
  changeMode: [value: AnnotatorUiMode];
}>();

defineProps<{
  currentMode: AnnotatorUiMode;
}>();

const modes: Array<{ value: AnnotatorUiMode; label: string }> = [
  { value: 'media', label: 'Media' },
  { value: 'annotate', label: 'Annotate' },
  { value: 'export', label: 'Export' }
];
</script>

<template>
  <nav class="sidebar-mode-switch" data-testid="mode-switch" aria-label="Editor workspace sections">
    <button
      v-for="mode in modes"
      :key="mode.value"
      type="button"
      :class="['sidebar-mode-button', { 'sidebar-mode-button-active': currentMode === mode.value }]"
      :data-testid="`mode-${mode.value}-button`"
      :aria-pressed="currentMode === mode.value"
      @click="emit('changeMode', mode.value)"
    >
      {{ mode.label }}
    </button>
  </nav>
</template>
