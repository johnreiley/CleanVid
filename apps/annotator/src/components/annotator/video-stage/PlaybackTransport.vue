<script setup lang="ts">
import PhPause from '@phosphor-icons-vue-icons/PhPause.vue.mjs';
import PhPlay from '@phosphor-icons-vue-icons/PhPlay.vue.mjs';
import PhSkipBack from '@phosphor-icons-vue-icons/PhSkipBack.vue.mjs';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';

const emit = defineEmits<{
  seek: [deltaSeconds: number];
  togglePlayback: [];
  togglePreviewPlayback: [];
}>();

defineProps<{
  isPlaying: boolean;
  previewPlaybackEnabled: boolean;
}>();
</script>

<template>
  <div class="transport-bar" data-testid="transport-bar">
    <div class="transport-cluster">
      <button
        type="button"
        class="icon-button icon-button-ghost"
        aria-label="Rewind 5 seconds"
        title="Rewind 5 seconds"
        @click="emit('seek', -5)"
      >
        <PhSkipBack :size="18" weight="fill" />
      </button>
      <button
        type="button"
        class="icon-button icon-button-primary"
        :aria-label="isPlaying ? 'Pause playback' : 'Play video'"
        :title="isPlaying ? 'Pause playback' : 'Play video'"
        @click="emit('togglePlayback')"
      >
        <PhPause v-if="isPlaying" :size="22" weight="fill" />
        <PhPlay v-else :size="22" weight="fill" />
      </button>
      <button
        type="button"
        class="icon-button icon-button-ghost"
        aria-label="Forward 5 seconds"
        title="Forward 5 seconds"
        @click="emit('seek', 5)"
      >
        <PhSkipForward :size="18" weight="fill" />
      </button>
    </div>

    <div class="transport-meta">
      <button
        type="button"
        :class="['preview-toggle', { 'preview-toggle-enabled': previewPlaybackEnabled }]"
        data-testid="preview-toggle"
        @click="emit('togglePreviewPlayback')"
      >
        <span class="preview-toggle-indicator" />
        <span>{{ previewPlaybackEnabled ? 'Preview On' : 'Preview Off' }}</span>
      </button>
      <div class="shortcut-cluster">
        <span class="shortcut-pill">SPACE</span>
        <span class="shortcut-copy">Play</span>
      </div>
      <div class="shortcut-cluster">
        <span class="shortcut-pill">&larr;/&rarr;</span>
        <span class="shortcut-copy">Seek</span>
      </div>
      <div class="shortcut-cluster">
        <span class="shortcut-pill">CTRL +/-/0</span>
        <span class="shortcut-copy">Zoom</span>
      </div>
    </div>
  </div>
</template>
