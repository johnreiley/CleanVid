<script setup lang="ts">
import InfoTooltip from '../../global/InfoTooltip.vue';

const emit = defineEmits<{
  processLinkedVideo: [];
  selectOutputPath: [];
  updateOutputPath: [value: string];
}>();

defineProps<{
  canProcessVideo: boolean;
  filterCountLabel: string;
  isOpeningVideo: boolean;
  isSelectingOutputPath: boolean;
  isProcessing: boolean;
  processButtonLabel: string;
  processProgressPercent: number;
  outputPath: string;
}>();
</script>

<template>
  <section class="file-actions" data-testid="processing-section-content">
    <div class="sidebar-section-heading">
      <h2>Filter count</h2>
    </div>

    <div class="export-metric-row">
      <span>Current filters</span>
      <strong data-testid="filter-count-value">{{ filterCountLabel }}</strong>
    </div>

    <label class="file-path-field">
      <span class="field-label-with-tooltip">
        <span>Output path</span>
        <InfoTooltip aria-label="Explain output path">
          Defaults to the same directory as the opened video
        </InfoTooltip>
      </span>

      <div class="file-path-row">
        <input
          data-testid="output-path-input"
          class="file-path-input"
          type="text"
          placeholder="C:\example\filepath"
          :value="outputPath"
          @input="emit('updateOutputPath', ($event.target as HTMLInputElement).value)"
        />

        <button
          type="button"
          class="subtle-action output-path-browse-button"
          data-testid="output-path-browse-button"
          :disabled="isOpeningVideo || isProcessing || isSelectingOutputPath"
          @click="emit('selectOutputPath')"
        >
          {{ isSelectingOutputPath ? 'Choosing...' : 'Browse' }}
        </button>
      </div>
    </label>

    <button
      type="button"
      :class="['process-button', { 'process-button-processing': isProcessing }]"
      data-testid="process-video-button"
      :disabled="!canProcessVideo || isOpeningVideo"
      :aria-valuenow="isProcessing ? processProgressPercent : undefined"
      aria-valuemin="0"
      aria-valuemax="100"
      @click="emit('processLinkedVideo')"
    >
      <span
        v-if="isProcessing"
        class="process-button-progress"
        data-testid="process-progress-fill"
        :style="{ width: `${processProgressPercent}%` }"
      />
      <span class="process-button-copy">{{ processButtonLabel }}</span>
    </button>
  </section>
</template>
