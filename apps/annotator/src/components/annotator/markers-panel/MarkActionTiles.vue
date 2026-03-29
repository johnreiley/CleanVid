<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import PhMute from '@phosphor-icons-vue-icons/PhSpeakerSimpleX.vue.mjs';

const emit = defineEmits<{
  selectType: [value: FilterType];
}>();

const props = defineProps<{
  pendingStart: number | null;
  pendingType: FilterType | null;
}>();

function isMarking(type: FilterType): boolean {
  return props.pendingType === type && props.pendingStart !== null;
}
</script>

<template>
  <section class="quick-actions">
    <button
      type="button"
      :class="['action-tile', 'action-tile-mute', { 'action-tile-active': isMarking('mute') }]"
      data-testid="toggle-mute"
      @click="emit('selectType', 'mute')"
    >
      <span class="action-glyph">
        <PhMute :size="28" weight="bold" />
      </span>
      <span class="action-copy">
        <strong>Mute Range</strong>
        <span class="action-subtext">Hotkey [M]</span>
      </span>
    </button>

    <button
      type="button"
      :class="['action-tile', 'action-tile-skip', { 'action-tile-active': isMarking('skip') }]"
      data-testid="toggle-skip"
      @click="emit('selectType', 'skip')"
    >
      <span class="action-glyph">
        <PhSkipForward :size="28" weight="bold" />
      </span>
      <span class="action-copy">
        <strong>Skip Range</strong>
        <span class="action-subtext">Hotkey [S]</span>
      </span>
    </button>
  </section>
</template>
