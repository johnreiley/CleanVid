<script setup lang="ts">
import InfoTooltip from '../../global/InfoTooltip.vue';

const emit = defineEmits<{
  processLinkedVideo: [];
  updateOutputPath: [value: string];
}>();

defineProps<{
  canProcessVideo: boolean;
  inputName: string;
  isOpeningVideo: boolean;
  isProcessing: boolean;
  markerCountLabel: string;
  processButtonLabel: string;
  processProgressPercent: number;
  outputPath: string;
}>();
</script>

<template>
  <section class="file-actions" data-testid="processing-section-content">
    <div class="panel-heading file-actions-heading">
      <div>
        <p class="section-kicker">Export</p>
        <h2>Render Output</h2>
      </div>
      <span class="panel-count">{{ markerCountLabel }}</span>
    </div>

    <div class="export-summary-card">
      <strong>{{ inputName || 'No source video loaded' }}</strong>
      <span>
        Processing uses the original source file, not the preview. The filters file is exported
        with the video.
      </span>
    </div>

    <label class="file-path-field">
      <span class="field-label-with-tooltip">
        <span>Output path</span>
        <InfoTooltip aria-label="Explain output path">
          Defaults to the same directory as the opened video
        </InfoTooltip>
      </span>

      <input
        data-testid="output-path-input"
        class="file-path-input"
        type="text"
        placeholder="C:\example\filepath"
        :value="outputPath"
        @input="emit('updateOutputPath', ($event.target as HTMLInputElement).value)"
      />
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
