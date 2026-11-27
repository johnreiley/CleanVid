<script setup lang="ts">
import type { ProfanitySuggestion } from '@cleanvid/shared';
import PhTrash from '@phosphor-icons-vue-icons/PhTrash.vue.mjs';

const emit = defineEmits<{
  analyzeProfanity: [];
  applyProfanitySuggestions: [];
  clearSubtitlePath: [];
  close: [];
  discardProfanitySuggestions: [];
  removeProfanitySuggestion: [id: string];
  seek: [start: number];
  selectSubtitlePath: [];
}>();

defineProps<{
  canAnalyzeProfanity: boolean;
  isAnalyzingProfanity: boolean;
  isSelectingSubtitlePath: boolean;
  progressPercent: number;
  showCloseButton?: boolean;
  subtitlePath: string;
  suggestionCountLabel: string;
  suggestions: ProfanitySuggestion[];
  warnings: string[];
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
  const labels = {
    provided: 'Provided Subtitle',
    embedded: 'Embedded Subtitle',
    transcript: 'Provided Transcript'
  };

  return sources.map((source) => labels[source]).join(' + ');
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

    <div class="profanity-capability-notice" data-testid="profanity-subtitle-guidance">
      <p>
        CleanVid uses embedded text subtitles unless you choose a subtitle file
        (.srt, .vtt, .ass, or .ssa) or a Media Transcription Studio transcript (.json).
        Transcript suggestions use word timestamps without added padding.
      </p>
      <p>
        If you need a subtitle file, try searching
        <a href="https://www.opensubtitles.com/" target="_blank" rel="noreferrer">
          OpenSubtitles
        </a>
        and then select the file here.
      </p>
    </div>

    <div class="media-action-row">
      <button
        type="button"
        class="subtle-action"
        data-testid="select-subtitle-path-button"
        :disabled="isSelectingSubtitlePath || isAnalyzingProfanity"
        @click="emit('selectSubtitlePath')"
      >
        {{ isSelectingSubtitlePath ? 'Choosing File...' : 'Choose Subtitle or Transcript' }}
      </button>

      <button
        type="button"
        class="subtle-action"
        data-testid="clear-subtitle-path-button"
        :disabled="subtitlePath === '' || isSelectingSubtitlePath || isAnalyzingProfanity"
        @click="emit('clearSubtitlePath')"
      >
        Clear
      </button>
    </div>

    <div class="export-metric-row">
      <span>Selected file</span>
      <strong data-testid="selected-subtitle-path">
        {{ subtitlePath === '' ? 'Embedded only' : subtitlePath }}
      </strong>
    </div>

    <button
      type="button"
      :class="['process-button', { 'process-button-processing': isAnalyzingProfanity }]"
      data-testid="analyze-profanity-button"
      :disabled="!canAnalyzeProfanity"
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

    <div v-if="warnings.length > 0" class="validation-summary" role="status" data-testid="profanity-warnings">
      <strong>Transcript warnings</strong>
      <ul>
        <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
      </ul>
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
        <div class="segment-card-surface profanity-suggestion-surface">
          <button
            type="button"
            class="profanity-suggestion-content"
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
            <div
              class="profanity-suggestion-snippet"
              data-testid="profanity-suggestion-snippet"
              :title="suggestion.snippet"
            >
              {{ suggestion.snippet }}
            </div>
            <div class="segment-duration" :title="suggestion.matchedTerms.join(', ')">
              {{ suggestion.matchedTerms.join(', ') }}
            </div>
          </button>

          <button
            type="button"
            class="profanity-suggestion-remove-button segment-delete-button"
            data-testid="remove-profanity-suggestion-button"
            aria-label="Remove draft suggestion"
            title="Remove draft suggestion"
            @click="emit('removeProfanitySuggestion', suggestion.id)"
          >
            <PhTrash :size="16" />
          </button>
        </div>
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
