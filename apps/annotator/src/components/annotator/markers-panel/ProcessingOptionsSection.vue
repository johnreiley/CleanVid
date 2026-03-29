<script setup lang="ts">
import CollapsiblePanelSection from '../../global/CollapsiblePanelSection.vue';
import InfoTooltip from '../../global/InfoTooltip.vue';

const emit = defineEmits<{
  processLinkedVideo: [];
  toggle: [];
  updateOutputPath: [value: string];
}>();

defineProps<{
  canProcessVideo: boolean;
  expanded: boolean;
  isOpeningVideo: boolean;
  isProcessing: boolean;
  processButtonLabel: string;
  processProgressPercent: number;
  outputPath: string;
}>();
</script>

<template>
  <section class="file-actions">
    <CollapsiblePanelSection
      kicker="Export"
      title="Options"
      heading-class="file-actions-heading"
      :expanded="expanded"
      toggle-test-id="toggle-processing-section"
      content-test-id="processing-section-content"
      @toggle="emit('toggle')"
    >
      <p class="file-link-empty">
        Processing always uses the original source file, not the preview. The filters file is
        exported with the video.
      </p>

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
    </CollapsiblePanelSection>
  </section>
</template>
