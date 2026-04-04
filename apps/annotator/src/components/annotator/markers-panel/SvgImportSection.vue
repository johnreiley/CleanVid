<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';

export type SvgImportMode = 'replace' | 'append';

const emit = defineEmits<{
  close: [];
  submit: [];
  updateMode: [value: SvgImportMode];
  updateText: [value: string];
  updateType: [value: FilterType];
}>();

const props = defineProps<{
  errorMessage: string;
  importMode: SvgImportMode;
  importType: FilterType;
  svgText: string;
  showCloseButton?: boolean;
}>();
</script>

<template>
  <section class="sidebar-section svg-import-section" data-testid="svg-import-section">
    <div class="sidebar-section-heading">
      <h2>Import SVG</h2>
      <button
        v-if="showCloseButton"
        type="button"
        class="subtle-action profanity-modal-close-button"
        data-testid="close-svg-import-button"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <div class="profanity-capability-notice">
      <p>
        Paste an SVG timeline with <code>&lt;rect class="cuts"&gt;</code> segments to convert it into
        CleanVid filters.
      </p>
      <p>The imported rect percentages are mapped against the currently loaded movie duration.</p>
    </div>

    <label class="svg-import-field">
      <span>Filter type</span>
      <select
        class="svg-import-select"
        data-testid="svg-import-type-select"
        :value="props.importType"
        @change="emit('updateType', ($event.target as HTMLSelectElement).value as FilterType)"
      >
        <option value="mute">Mute</option>
        <option value="skip">Skip</option>
      </select>
    </label>

    <label class="svg-import-field">
      <span>Import mode</span>
      <select
        class="svg-import-select"
        data-testid="svg-import-mode-select"
        :value="props.importMode"
        @change="emit('updateMode', ($event.target as HTMLSelectElement).value as SvgImportMode)"
      >
        <option value="replace">Replace current timeline</option>
        <option value="append">Append to current timeline</option>
      </select>
    </label>

    <label class="svg-import-field">
      <span>SVG markup</span>
      <textarea
        class="file-path-input svg-import-textarea"
        data-testid="svg-import-textarea"
        :value="props.svgText"
        spellcheck="false"
        @input="emit('updateText', ($event.target as HTMLTextAreaElement).value)"
      ></textarea>
    </label>

    <div v-if="props.errorMessage" class="validation-summary" data-testid="svg-import-error">
      <strong>Unable to import SVG</strong>
      <div>{{ props.errorMessage }}</div>
    </div>

    <div class="media-action-row">
      <button
        type="button"
        class="subtle-action"
        data-testid="apply-svg-import-button"
        @click="emit('submit')"
      >
        Import SVG
      </button>

      <button
        type="button"
        class="subtle-action"
        data-testid="cancel-svg-import-button"
        @click="emit('close')"
      >
        Cancel
      </button>
    </div>
  </section>
</template>
