<script setup lang="ts">
import {
  normalizeProfanityText, profanityTokens,
  type MuteRange, type ProfanityAnalysisOptions, type ProfanityOccurrence, type ProfanitySuggestion, type SubtitleMode
} from '@cleanvid/shared';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import PhTrash from '@phosphor-icons-vue-icons/PhTrash.vue.mjs';
import type { ProfanityDraft, ProfanityReviewState } from '../../../annotator-types';

const emit = defineEmits<{
  analyzeProfanity: [];
  applyProfanitySuggestions: [];
  close: [];
  discardProfanitySuggestions: [];
  removeProfanitySuggestion: [id: string];
  seek: [start: number];
  pick: ['subtitle' | 'transcript'];
  options: [Partial<ProfanityAnalysisOptions>];
  loadTracks: [];
  selectDetection: [id: string];
  reviewDetection: [id: string, status: 'approved' | 'rejected'];
  approveHighConfidence: [];
  editDetection: [id: string, range: MuteRange];
  startPreview: [range: MuteRange, muted: boolean, loop: boolean];
  stopPreview: [];
}>();

const props = defineProps<{
  canAnalyzeProfanity: boolean;
  isAnalyzingProfanity: boolean;
  progressPercent: number;
  duration: number;
  review: ProfanityReviewState;
  suggestionCountLabel: string;
  suggestions: ProfanitySuggestion[];
  warnings: string[];
  errorMessage: string;
  statusMessage: string;
}>();

const timingLabels = {
  'transcript-word': 'Transcript word', 'transcript-segment': 'Transcript segment',
  'context-estimated': 'Context estimate', 'subtitle-cue': 'Subtitle cue',
  unresolved: 'Unresolved', manual: 'Manual'
};
const agreementLabels = {
  both: 'Both sources', 'transcript-only': 'Transcript only', 'subtitle-only': 'Subtitle only', conflicting: 'Conflicting'
};
const sourceLabels = {
  provided: 'Provided Subtitle', embedded: 'Embedded Subtitle', transcript: 'Provided Transcript'
};
const needsReview = (item: ProfanityDraft) => (item.needsReview || Boolean(item.editedRange)) && item.reviewStatus === 'pending';
const filters = [
  { label: 'All', accepts: () => true },
  { label: 'High confidence', accepts: (item: ProfanityDraft) => item.confidence === 'high' },
  { label: 'Transcript only', accepts: (item: ProfanityDraft) => item.agreement === 'transcript-only' },
  { label: 'Subtitle only', accepts: (item: ProfanityDraft) => item.agreement === 'subtitle-only' },
  { label: 'Estimated', accepts: (item: ProfanityDraft) => item.timingMethod === 'context-estimated' },
  { label: 'Needs review', accepts: needsReview }
];
const filterIndex = ref(0);
const startInput = ref('');
const endInput = ref('');
const loop = ref(false);
const drafts = computed(() => props.review.detections ?? []);
const visible = computed(() => drafts.value.filter(filters[filterIndex.value].accepts));
const selected = computed(() => drafts.value.find((item) => item.id === props.review.selectedId));
const selectedRange = computed(() => selected.value?.editedRange ?? selected.value?.proposedRange);
const busy = computed(() => props.isAnalyzingProfanity || props.review.isSelectingFile || props.review.isLoadingTracks);
const approved = computed(() => drafts.value.filter((item) => item.reviewStatus === 'approved' && !item.applied).length);
const eligible = computed(() => drafts.value.filter((item) => item.reviewStatus === 'pending' &&
  item.confidence === 'high' && !item.needsReview && !item.editedRange && item.proposedRange).length);
const summary = computed(() => {
  const agreements = new Map<string, number>();
  const timings = new Map<string, number>();
  for (const item of drafts.value) {
    const agreement = agreementLabels[item.agreement];
    const timing = timingLabels[item.editedRange ? 'manual' : item.timingMethod];
    agreements.set(agreement, (agreements.get(agreement) ?? 0) + 1);
    timings.set(timing, (timings.get(timing) ?? 0) + 1);
  }
  return [agreements, timings];
});

watch(() => props.review.detections, () => { filterIndex.value = 0; });
watch([selected, selectedRange], ([item, range]) => {
  startInput.value = range ? String(Number(range.start.toFixed(3))) : item ? String(item.evidence[0].start) : '';
  endInput.value = range ? String(Number(range.end.toFixed(3))) : '';
});
onBeforeUnmount(() => emit('stopPreview'));

const editRange = computed(() => {
  if (!startInput.value || !endInput.value) return null;
  const start = Number(startInput.value);
  const end = Number(endInput.value);
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= props.duration
    ? { start, end } : null;
});

function nudge(field: 'start' | 'end', delta: number) {
  const input = field === 'start' ? startInput : endInput;
  const baseline = input.value ? Number(input.value) : selectedRange.value?.[field] ?? selected.value?.evidence[0].start ?? 0;
  input.value = String(Number(Math.max(0, Math.min(props.duration, baseline + delta)).toFixed(3)));
}

function saveRange() {
  if (selected.value && editRange.value) emit('editDetection', selected.value.id, editRange.value);
}

function advance() {
  const index = drafts.value.findIndex((item) => item.id === props.review.selectedId);
  const next = drafts.value.slice(index + 1).find(needsReview) ?? drafts.value.slice(0, index).find(needsReview);
  if (!next) return;
  if (!filters[filterIndex.value].accepts(next)) filterIndex.value = 0;
  emit('selectDetection', next.id);
}

function changePadding(side: 'before' | 'after', value: string) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
  emit('options', { wordPadding: { before: 0, after: 0, ...props.review.options.wordPadding, [side]: milliseconds / 1000 } });
}

function evidenceText(item: ProfanityOccurrence) {
  const context = normalizeProfanityText(item.context);
  const tokens = profanityTokens(context);
  const start = tokens[item.tokenStart]?.start;
  const end = tokens[item.tokenEnd - 1]?.end;
  if (start === undefined || end === undefined) return { before: context, match: '', after: '' };
  return { before: context.slice(0, start), match: context.slice(start, end), after: context.slice(end) };
}

function formatTimestamp(seconds: number): string {
  const totalMilliseconds = Math.round(Math.max(0, seconds) * 1000);
  const wholeSeconds = Math.floor(totalMilliseconds / 1000);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  const milliseconds = totalMilliseconds % 1000;

  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function formatSourceLabel(suggestion: ProfanitySuggestion): string {
  const sources = suggestion.sources ?? [suggestion.source];
  return sources.map((source) => sourceLabels[source]).join(' + ');
}
</script>

<template>
  <section class="sidebar-section profanity-analysis-section" data-testid="profanity-analysis-section">
    <div class="sidebar-section-heading">
      <h2>Auto-Detect Profanity</h2>
      <button
        type="button"
        class="subtle-action profanity-modal-close-button"
        data-testid="close-profanity-modal-button"
        @click="emit('close')"
      >
        Close
      </button>
    </div>

    <p class="profanity-capability-notice" data-testid="profanity-subtitle-guidance">
      Use subtitles, a Media Transcription Studio transcript (.json), or both.
    </p>

    <fieldset class="profanity-sources" :disabled="busy">
      <label class="profanity-field">
        Subtitles
        <select :value="review.options.subtitleMode"
          @change="emit('options', { subtitleMode: ($event.target as HTMLSelectElement).value as SubtitleMode })">
          <option value="auto">Embedded</option>
          <option value="external">External file</option>
          <option value="none">None</option>
        </select>
      </label>
      <div v-if="review.options.subtitleMode === 'auto'" class="media-action-row">
        <button type="button" class="subtle-action" @click="emit('loadTracks')">Find embedded tracks</button>
        <label v-if="review.tracks.length" class="profanity-field">
          Embedded track
          <select :value="review.options.subtitleStreamIndex ?? ''"
            @change="emit('options', { subtitleStreamIndex: ($event.target as HTMLSelectElement).value === ''
              ? undefined : Number(($event.target as HTMLSelectElement).value) })">
            <option value="">Automatic</option>
            <option v-for="track in review.tracks" :key="track.index" :value="track.index">
              {{ ['Track ' + track.index, track.language, track.title, track.forced ? 'Forced' : ''].filter(Boolean).join(' · ') }}
            </option>
          </select>
        </label>
      </div>
      <div class="media-action-row">
        <button type="button" class="subtle-action" data-testid="select-subtitle-path-button" @click="emit('pick', 'subtitle')">
          Choose subtitle
        </button>
        <button type="button" class="subtle-action" data-testid="clear-subtitle-path-button"
          :disabled="!review.options.subtitlePath"
          @click="emit('options', { subtitlePath: undefined, subtitleMode: review.options.subtitleMode === 'external' ? 'auto' : review.options.subtitleMode })">
          Clear subtitle
        </button>
      </div>
      <span v-if="review.options.subtitlePath" class="profanity-path" data-testid="selected-subtitle-path">
        {{ review.options.subtitlePath }}
      </span>
      <div class="media-action-row">
        <button type="button" class="subtle-action" data-testid="select-transcript-path-button" @click="emit('pick', 'transcript')">
          Choose MTS transcript
        </button>
        <button type="button" class="subtle-action" data-testid="clear-transcript-path-button"
          :disabled="!review.options.transcriptPath" @click="emit('options', { transcriptPath: undefined })">
          Clear transcript
        </button>
      </div>
      <span v-if="review.options.transcriptPath" class="profanity-path" data-testid="selected-transcript-path">
        {{ review.options.transcriptPath }}
      </span>
      <details v-if="review.options.subtitleMode !== 'none' && review.options.transcriptPath">
        <summary>Timing options</summary>
        <label class="profanity-field">
          Subtitle offset (seconds)
          <input type="number" step="0.1" placeholder="Automatic" :value="review.options.subtitleOffset ?? ''"
            @change="emit('options', { subtitleOffset: ($event.target as HTMLInputElement).value === ''
              ? undefined : ($event.target as HTMLInputElement).valueAsNumber })" />
        </label>
        <label class="profanity-field">
          <input type="checkbox" :checked="review.options.estimateMissingWords !== false"
            @change="emit('options', { estimateMissingWords: ($event.target as HTMLInputElement).checked })" />
          Estimate missing words
        </label>
        <div class="media-action-row">
          <label v-for="side in (['before', 'after'] as const)" :key="side" class="profanity-field">
            Word padding {{ side }} (ms)
            <input type="number" min="0" step="10" :value="(review.options.wordPadding?.[side] ?? 0) * 1000"
              @change="changePadding(side, ($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </details>
    </fieldset>

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

    <p v-if="errorMessage" role="alert">{{ errorMessage }}</p>
    <p v-else-if="isAnalyzingProfanity || review.result" role="status">{{ statusMessage }}</p>
    <div v-if="review.result" class="profanity-source-summary">
      <div>
        Subtitles {{ review.result.usedSources.includes('embedded') ? '· Embedded' :
          review.result.usedSources.includes('provided') ? '· External file' : 'unavailable for this run' }}
      </div>
      <div v-if="review.result.transcriptDetails">
        MTS {{ review.result.transcriptDetails.fileName }} · {{ review.result.transcriptDetails.model }} ·
        audio stream {{ review.result.transcriptDetails.audioStreamIndex }} ·
        {{ review.result.transcriptDetails.completedChunks }}/{{ review.result.transcriptDetails.expectedChunks }} chunks
      </div>
      <div v-else>Transcript unavailable for this run</div>
      <div v-if="review.result.subtitleAlignment">
        {{ review.result.subtitleAlignment.message }}
        Offset {{ review.result.subtitleAlignment.offset.toFixed(2) }} s ·
        {{ review.result.subtitleAlignment.anchorCount }} dialogue anchors
      </div>
    </div>

    <div class="export-metric-row">
      <span>{{ review.detections ? 'Draft detections' : 'Draft suggestions' }}</span>
      <strong data-testid="profanity-suggestion-count">{{ suggestionCountLabel }}</strong>
    </div>

    <div v-if="warnings.length > 0" class="validation-summary" role="status" data-testid="profanity-warnings">
      <strong>Source warnings</strong>
      <ul>
        <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
      </ul>
    </div>

    <template v-if="review.detections !== null">
      <div v-if="drafts.length" class="profanity-review-summary">
        <div v-for="(counts, index) in summary" :key="index">
          <span v-for="[label, count] in counts" :key="label">{{ label }} {{ count }}</span>
        </div>
        <label class="profanity-field">
          Filter detections
          <select v-model="filterIndex">
            <option v-for="(filter, index) in filters" :key="filter.label" :value="index">
              {{ filter.label }} ({{ drafts.filter(filter.accepts).length }})
            </option>
          </select>
        </label>
      </div>
      <div class="media-action-row" v-if="drafts.length">
        <button type="button" class="subtle-action" :disabled="eligible === 0" @click="emit('approveHighConfidence')">
          Approve eligible high confidence ({{ eligible }})
        </button>
        <button type="button" class="subtle-action"
          :disabled="!drafts.some(item => needsReview(item) && item.id !== review.selectedId)"
          @click="advance">
          Next pending review
        </button>
      </div>

      <p v-if="!visible.length" class="segments-empty">No detections {{ drafts.length ? 'match this filter' : 'found' }}.</p>
      <ul v-else class="segment-list profanity-suggestion-list" data-testid="profanity-detection-list">
        <li v-for="item in visible" :key="item.id" class="segment-card profanity-suggestion-card">
          <button type="button" class="profanity-suggestion-content profanity-detection"
            :aria-pressed="review.selectedId === item.id" @click="emit('selectDetection', item.id)">
            <strong>{{ item.evidence[0].matchedText }}</strong>
            <span>{{ item.editedRange || item.proposedRange
              ? formatTimestamp((item.editedRange ?? item.proposedRange)!.start) + ' – ' +
                formatTimestamp((item.editedRange ?? item.proposedRange)!.end)
              : 'Unresolved near ' + formatTimestamp(item.evidence[0].start) }}</span>
            <span>{{ agreementLabels[item.agreement] }} · {{ item.confidence }} confidence ·
              {{ timingLabels[item.editedRange ? 'manual' : item.timingMethod] }} ·
              {{ item.applied ? 'Applied' : item.reviewStatus }}</span>
            <span v-if="item.reviewReasons.length">{{ item.reviewReasons[0] }}</span>
          </button>
        </li>
      </ul>

      <section v-if="selected" class="profanity-review-editor" aria-label="Selected detection">
        <strong>{{ selected.evidence[0].matchedText }}</strong>
        <ul v-if="selected.reviewReasons.length">
          <li v-for="reason in selected.reviewReasons" :key="reason">{{ reason }}</li>
        </ul>
        <details>
          <summary>Source evidence</summary>
          <div v-for="item in selected.evidence" :key="item.id">
            <strong>{{ sourceLabels[item.source] }}</strong>
            <p>{{ evidenceText(item).before }}<mark>{{ evidenceText(item).match }}</mark>{{ evidenceText(item).after }}</p>
          </div>
          <div v-if="selected.nearbyTranscript">
            <strong>Nearby transcript</strong>
            <p>{{ selected.nearbyTranscript.before }} <mark v-if="selected.nearbyTranscript.match || selected.timingMethod === 'context-estimated'">
              {{ selected.nearbyTranscript.match || '[missing word]' }}</mark> {{ selected.nearbyTranscript.after }}</p>
          </div>
          <p v-if="selected.transcriptProbability !== undefined">
            MTS recognition probability
            {{ selected.transcriptProbability === null ? 'unknown' : selected.transcriptProbability.toFixed(2) }}
            {{ selected.transcriptProbability !== null && selected.hasUnknownProbability ? '· Some word probabilities unknown' : '' }}
          </p>
        </details>

        <div v-if="!selected.applied" class="media-action-row">
          <div v-for="field in (['start', 'end'] as const)" :key="field" class="profanity-field">
            <label :for="'profanity-' + field">{{ field === 'start' ? 'Start' : 'End' }} (seconds)</label>
            <div class="media-action-row profanity-time-input">
              <button type="button" class="subtle-action" :aria-label="'Move ' + field + ' back 100 ms'"
                @click="nudge(field, -0.1)">−</button>
              <input :id="'profanity-' + field" type="number" min="0" :max="duration" step="0.001"
                :value="field === 'start' ? startInput : endInput"
                @input="field === 'start' ? startInput = ($event.target as HTMLInputElement).value
                  : endInput = ($event.target as HTMLInputElement).value" />
              <button type="button" class="subtle-action" :aria-label="'Move ' + field + ' forward 100 ms'"
                @click="nudge(field, 0.1)">+</button>
            </div>
          </div>
        </div>

        <div class="media-action-row">
          <button v-if="!selected.applied" type="button" class="subtle-action" :disabled="!editRange" @click="saveRange">Use edited range</button>
          <label><input v-model="loop" type="checkbox" /> Loop</label>
          <button type="button" class="subtle-action" :disabled="!selectedRange"
            @click="selectedRange && emit('startPreview', selectedRange, false, loop)">Play original</button>
          <button type="button" class="subtle-action" :disabled="!selectedRange"
            @click="selectedRange && emit('startPreview', selectedRange, true, loop)">Play muted</button>
          <button type="button" class="subtle-action" @click="emit('stopPreview')">Stop</button>
        </div>
        <div v-if="!selected.applied" class="media-action-row">
          <button type="button" class="subtle-action" :disabled="!selectedRange || selected.reviewStatus === 'approved'"
            @click="emit('reviewDetection', selected.id, 'approved')">Approve</button>
          <button type="button" class="subtle-action" :disabled="selected.reviewStatus === 'rejected'"
            @click="emit('reviewDetection', selected.id, 'rejected')">Reject</button>
        </div>
      </section>
    </template>

    <div v-else-if="suggestions.length === 0" class="segments-empty">
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
        :disabled="(review.detections ? approved === 0 : suggestions.length === 0) || busy"
        @click="emit('applyProfanitySuggestions'); if (!review.detections) emit('close')"
      >
        {{ review.detections ? `Apply approved (${approved}) as mute filters` : 'Apply all as mute filters' }}
      </button>

      <button
        type="button"
        class="subtle-action"
        data-testid="discard-profanity-suggestions-button"
        :disabled="(review.detections ? drafts.length === 0 : suggestions.length === 0) || busy"
        @click="emit('discardProfanitySuggestions'); emit('close')"
      >
        Discard suggestions
      </button>
    </div>
  </section>
</template>
