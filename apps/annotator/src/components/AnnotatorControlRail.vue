<script setup lang="ts">
import PhPause from '@phosphor-icons-vue-icons/PhPause.vue.mjs';
import PhPlay from '@phosphor-icons-vue-icons/PhPlay.vue.mjs';
import PhSkipBack from '@phosphor-icons-vue-icons/PhSkipBack.vue.mjs';
import PhSkipForward from '@phosphor-icons-vue-icons/PhSkipForward.vue.mjs';
import type { FilterType } from '@cleanvid/shared';

const emit = defineEmits<{
  activeTypeChange: [value: FilterType];
  markEnd: [];
  markStart: [];
  seek: [deltaSeconds: number];
  togglePlayback: [];
}>();

defineProps<{
  activeType: FilterType;
  errorMessage: string;
  isPlaying: boolean;
  seekStepSeconds: number;
  segmentIssueCount: number;
  statusMessage: string;
}>();

function emitActiveType(event: Event) {
  const value = (event.target as HTMLSelectElement).value;

  if (value !== 'mute' && value !== 'skip') {
    return;
  }

  emit('activeTypeChange', value);
}
</script>

<template>
  <section class="control-rail" data-testid="control-rail">
    <article class="panel control-card">
      <div class="section-heading compact-heading">
        <div>
          <p class="section-kicker">Transport</p>
          <h2>Playback</h2>
        </div>
      </div>

      <div class="transport-cluster">
        <button
          type="button"
          class="icon-button"
          :aria-label="`Rewind ${seekStepSeconds} seconds`"
          :title="`Rewind ${seekStepSeconds} seconds`"
          @click="emit('seek', -seekStepSeconds)"
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
          <PhPause v-if="isPlaying" :size="20" weight="fill" />
          <PhPlay v-else :size="20" weight="fill" />
        </button>
        <button
          type="button"
          class="icon-button"
          :aria-label="`Forward ${seekStepSeconds} seconds`"
          :title="`Forward ${seekStepSeconds} seconds`"
          @click="emit('seek', seekStepSeconds)"
        >
          <PhSkipForward :size="18" weight="fill" />
        </button>
      </div>
    </article>

    <article class="panel control-card">
      <div class="section-heading compact-heading">
        <div>
          <p class="section-kicker">Marker Tools</p>
          <h2>Create marker</h2>
        </div>
      </div>

      <label class="field">
        <span>Marker Type</span>
        <select data-testid="active-type" :value="activeType" @change="emitActiveType">
          <option value="mute">Mute</option>
          <option value="skip">Skip</option>
        </select>
      </label>

      <div class="button-stack">
        <button type="button" class="primary-button" data-testid="mark-start" @click="emit('markStart')">
          Mark Start
        </button>
        <button
          type="button"
          class="primary-button accent-button"
          data-testid="mark-end"
          @click="emit('markEnd')"
        >
          Mark End
        </button>
      </div>

      <p class="shortcut-note">Shortcuts: <span>S</span> start, <span>E</span> end, <span>Space</span> play</p>
    </article>

    <article class="panel control-card">
      <div class="section-heading compact-heading">
        <div>
          <p class="section-kicker">Feedback</p>
          <h2>Session state</h2>
        </div>
      </div>

      <p class="status" data-testid="status-message">{{ statusMessage }}</p>
      <p v-if="errorMessage" class="error" data-testid="error-message">{{ errorMessage }}</p>
      <p v-else-if="segmentIssueCount > 0" class="warning-text">
        {{ segmentIssueCount }} validation issue{{ segmentIssueCount === 1 ? '' : 's' }} need attention.
      </p>
      <p v-else class="hint-text">
        Marker edits are live. Export when the list is valid and ready for the CLI.
      </p>
    </article>
  </section>
</template>
