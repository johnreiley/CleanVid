<script setup lang="ts">
import type {
  ProfanityAnalysisCapabilities,
  ProfanityAnalysisOptions,
  ProfanitySuggestion
} from '@cleanvid/shared';
import InfoTooltip from '../../global/InfoTooltip.vue';

const emit = defineEmits<{
  analyzeProfanity: [];
  applyProfanitySuggestions: [];
  close: [];
  discardProfanitySuggestions: [];
  seek: [start: number];
  updateAllowRemoteSubtitles: [value: boolean];
  updateEnhancedMode: [value: boolean];
}>();

defineProps<{
  canAnalyzeProfanity: boolean;
  capabilities: ProfanityAnalysisCapabilities;
  isAnalyzingProfanity: boolean;
  progressPercent: number;
  showCloseButton?: boolean;
  suggestionCountLabel: string;
  suggestions: ProfanitySuggestion[];
  options: ProfanityAnalysisOptions;
}>();

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const wholeSeconds = Math.floor(safeSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  const milliseconds = Math.round((safeSeconds - wholeSeconds) * 1000);

  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function formatSourceLabel(suggestion: ProfanitySuggestion): string {
  const sources = suggestion.sources ?? [suggestion.source];

  return sources
    .map((source) => {
      switch (source) {
        case 'embedded':
          return 'Embedded';
        case 'remote':
          return 'Remote';
        case 'whisper-tiny':
          return 'Whisper Tiny';
        case 'whisper-base':
          return 'Whisper Base';
      }
    })
    .join(' + ');
}
</script>

<template>
  <section class="sidebar-section profanity-analysis-section" data-testid="profanity-analysis-section">
    <div class="sidebar-section-heading">
      <h2>Auto-Detect Profanity</h2>
      <button
        v-if="showCloseButton"
        type="button"
        class="subtle-action profanity-modal-close-button"
        data-testid="close-profanity-modal-button"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <div class="profanity-option-list">
      <label class="profanity-option-row">
        <input
          data-testid="enhanced-mode-toggle"
          type="checkbox"
          :checked="options.enhancedMode"
          :disabled="isAnalyzingProfanity || !capabilities.whisperTinyAvailable"
          @change="emit('updateEnhancedMode', ($event.target as HTMLInputElement).checked)"
        />
        <span>Enhanced mode</span>
        <InfoTooltip aria-label="Explain enhanced mode">
          Runs Whisper tiny when subtitles look sparse so missing profanity can still be caught.
        </InfoTooltip>
      </label>

      <label
        :class="[
          'profanity-option-row',
          { 'profanity-option-row-disabled': !capabilities.remoteSubtitlesAvailable }
        ]"
      >
        <input
          data-testid="allow-remote-subtitles-toggle"
          type="checkbox"
          :checked="options.allowRemoteSubtitles"
          :disabled="isAnalyzingProfanity || !capabilities.remoteSubtitlesAvailable"
          @change="emit('updateAllowRemoteSubtitles', ($event.target as HTMLInputElement).checked)"
        />
        <span>Allow OpenSubtitles fallback</span>
        <InfoTooltip aria-label="Explain remote subtitles">
          Uses your configured OpenSubtitles credentials if embedded subtitles are missing.
        </InfoTooltip>
      </label>
    </div>

    <div
      v-if="!capabilities.whisperBaseAvailable || !capabilities.whisperTinyAvailable"
      class="profanity-capability-notice"
      data-testid="profanity-capability-notice"
    >
      <p v-if="!capabilities.whisperBaseAvailable">
        Whisper Base fallback is not configured. Movies without usable subtitles need
        `CLEANVID_WHISPER_CPP_BIN` plus `CLEANVID_WHISPER_CPP_BASE_MODEL`, or
        `CLEANVID_WHISPER_CPP_MODELS_DIR` with `ggml-base.en.bin`.
      </p>
      <p v-if="!capabilities.whisperTinyAvailable">
        Enhanced mode is unavailable until `CLEANVID_WHISPER_CPP_BIN` plus
        `CLEANVID_WHISPER_CPP_TINY_MODEL`, or `CLEANVID_WHISPER_CPP_MODELS_DIR` with
        `ggml-tiny.en.bin`, are configured.
      </p>
    </div>

    <button
      type="button"
      :class="['process-button', { 'process-button-processing': isAnalyzingProfanity }]"
      data-testid="analyze-profanity-button"
      :disabled="!canAnalyzeProfanity"
      :aria-valuenow="isAnalyzingProfanity ? progressPercent : undefined"
      aria-valuemin="0"
      aria-valuemax="100"
      @click="emit('analyzeProfanity')"
    >
      <span
        v-if="isAnalyzingProfanity"
        class="process-button-progress"
        data-testid="analyze-profanity-progress-fill"
        :style="{ width: `${progressPercent}%` }"
      />
      <span class="process-button-copy">
        {{ isAnalyzingProfanity ? `Analyzing ${Math.round(progressPercent)}%` : 'Detect Profanity' }}
      </span>
    </button>

    <div class="export-metric-row">
      <span>Draft suggestions</span>
      <strong data-testid="profanity-suggestion-count">{{ suggestionCountLabel }}</strong>
    </div>

    <div v-if="suggestions.length === 0" class="segments-empty">
      <p>No draft profanity suggestions yet</p>
    </div>

    <ul v-else class="segment-list profanity-suggestion-list" data-testid="profanity-suggestion-list">
      <li
        v-for="suggestion in suggestions"
        :key="suggestion.id"
        class="segment-card profanity-suggestion-card"
      >
        <button
          type="button"
          class="segment-card-surface profanity-suggestion-surface"
          data-testid="profanity-suggestion-seek"
          @click="emit('seek', suggestion.start)"
        >
          <div class="segment-card-top">
            <div class="segment-card-type">
              <span class="segment-type-label segment-type-label-mute">{{ formatSourceLabel(suggestion) }}</span>
            </div>
          </div>
          <div class="segment-time-row">
            <span>{{ formatTimestamp(suggestion.start) }}</span>
            <span class="segment-range-separator">-&gt;</span>
            <span>{{ formatTimestamp(suggestion.end) }}</span>
          </div>
          <div class="profanity-suggestion-snippet" data-testid="profanity-suggestion-snippet">
            {{ suggestion.snippet }}
          </div>
          <div class="segment-duration">
            {{ suggestion.matchedTerms.join(', ') }}
          </div>
        </button>
      </li>
    </ul>

    <div class="media-action-row">
      <button
        type="button"
        class="subtle-action"
        data-testid="apply-profanity-suggestions-button"
        :disabled="suggestions.length === 0 || isAnalyzingProfanity"
        @click="emit('applyProfanitySuggestions')"
      >
        Apply all as mute filters
      </button>

      <button
        type="button"
        class="subtle-action"
        data-testid="discard-profanity-suggestions-button"
        :disabled="suggestions.length === 0 || isAnalyzingProfanity"
        @click="emit('discardProfanitySuggestions')"
      >
        Discard suggestions
      </button>
    </div>
  </section>
</template>
