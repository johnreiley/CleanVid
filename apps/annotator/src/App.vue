<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import { onBeforeUnmount, onMounted, proxyRefs, ref, watch } from 'vue';
import AnnotatorTopBar from './components/annotator/top-bar/AnnotatorTopBar.vue';
import ProfanityAnalysisSection from './components/annotator/markers-panel/ProfanityAnalysisSection.vue';
import MarkersPanel from './components/annotator/markers-panel/MarkersPanel.vue';
import VideoStage from './components/annotator/video-stage/VideoStage.vue';
import { useAnnotatorState } from './composables/useAnnotatorState';

type AnnotatorUiMode = 'media' | 'annotate' | 'export';
type SvgImportMode = 'replace' | 'append';

const annotator = proxyRefs(useAnnotatorState());
const segmentScrollKey = ref(0);
const uiMode = ref<AnnotatorUiMode>('media');

function handleActiveTypeChange(value: FilterType) {
  annotator.activeType = value;
}

function handleMarkTypeRequest(value: FilterType) {
  annotator.activeType = value;
  annotator.toggleMark(value);
}

function handleSegmentUpdate(payload: { id: string; field: 'start' | 'end'; value: string }) {
  annotator.updateSegment(payload.id, payload.field, payload.value);
}

function handleOutputPathUpdate(value: string) {
  annotator.updateOutputPath(value);
}

function handleSvgImportModeChange(value: SvgImportMode) {
  annotator.updateSvgImportMode(value);
}

function handleModeChange(value: AnnotatorUiMode) {
  uiMode.value = value;
}

function handleTimelineSegmentSelect(id: string) {
  annotator.selectSegment(id);
  segmentScrollKey.value += 1;
}

watch(
  () => annotator.videoUrl,
  (videoUrl, previousVideoUrl) => {
    if (!videoUrl) {
      uiMode.value = 'media';
      return;
    }

    if (!previousVideoUrl && videoUrl) {
      uiMode.value = 'annotate';
    }
  }
);

watch(
  () => annotator.isProcessing,
  (isProcessing, wasProcessing) => {
    if (isProcessing && !wasProcessing) {
      uiMode.value = 'export';
    }
  }
);

watch(
  () => annotator.skpReviewRequestKey,
  (skpReviewRequestKey, previousKey) => {
    if (
      skpReviewRequestKey > 0 &&
      skpReviewRequestKey !== previousKey &&
      annotator.skpDraftSegments.length > 0
    ) {
      uiMode.value = 'annotate';
    }
  }
);

onMounted(() => {
  window.addEventListener('keydown', annotator.handleKeydown);
  window.addEventListener('beforeunload', annotator.handleBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', annotator.handleKeydown);
  window.removeEventListener('beforeunload', annotator.handleBeforeUnload);
  annotator.cleanup();
});
</script>

<template>
  <div class="app-shell">
    <AnnotatorTopBar
      :movie-label="annotator.inputName || 'No file loaded'"
      @export="annotator.exportFilters"
    />

    <main class="workspace" data-testid="workspace">
      <MarkersPanel
        :active-type="annotator.activeType"
        :can-import-svg="annotator.effectiveDuration > 0"
        :can-process-video="annotator.canProcessVideo"
        :current-mode="uiMode"
        :error-message="annotator.errorMessage"
        :input-name="annotator.inputName"
        :is-opening-video="annotator.isOpeningVideo"
        :open-video-progress-percent="annotator.openVideoProgressPercent"
        :is-selecting-output-path="annotator.isSelectingOutputPath"
        :is-processing="annotator.isProcessing"
        :marker-count-label="annotator.markerCountLabel"
        :skp-draft-count-label="annotator.skpDraftCountLabel"
        :skp-draft-segments="annotator.skpDraftSegments"
        :skp-import-summary-text="annotator.skpImportSummaryText"
        :skp-import-warnings="annotator.skpImportWarnings"
        :skp-review-request-key="annotator.skpReviewRequestKey"
        :output-path="annotator.outputPath"
        :process-progress-percent="annotator.processProgressPercent"
        :pending-start="annotator.pendingStart"
        :pending-type="annotator.pendingType"
        :selection-scroll-key="segmentScrollKey"
        :segment-issues="annotator.segmentIssues"
        :selected-segment-id="annotator.selectedSegmentId"
        :sorted-segments="annotator.sortedSegments"
        :status-message="annotator.statusMessage"
        :svg-import-error="annotator.svgImportError"
        :svg-import-mode="annotator.svgImportMode"
        :svg-import-success-key="annotator.svgImportSuccessKey"
        :svg-import-text="annotator.svgImportText"
        :svg-import-type="annotator.svgImportType"
        @active-type-change="handleActiveTypeChange"
        @apply-skp-import="annotator.applySkpImport"
        @clear-svg-import-error="annotator.clearSvgImportError"
        @change-mode="handleModeChange"
        @discard-skp-import="annotator.discardSkpImport"
        @filters-selected="annotator.loadFilterFile"
        @open-video="annotator.openVideo"
        @select-output-path="annotator.selectOutputPath"
        @process-linked-video="annotator.processLinkedVideo"
        @submit-svg-import="annotator.importSvgFilters"
        @toggle-mark="annotator.toggleMark"
        @seek="annotator.seekTo"
        @select-segment="annotator.selectSegment"
        @update-output-path="handleOutputPathUpdate"
        @update-segment="handleSegmentUpdate"
        @update-svg-import-mode="handleSvgImportModeChange"
        @update-svg-import-text="annotator.updateSvgImportText"
        @update-svg-import-type="annotator.updateSvgImportType"
        @delete-segment="annotator.deleteSegment"
      >
        <template #profanity="{ close }">
          <ProfanityAnalysisSection
            :can-analyze-profanity="annotator.canAnalyzeProfanity"
            :is-analyzing-profanity="annotator.isAnalyzingProfanity"
            :progress-percent="annotator.analyzeProfanityProgressPercent"
            :review="annotator.profanityReview"
            :duration="annotator.effectiveDuration"
            :suggestion-count-label="annotator.profanitySuggestionCountLabel"
            :suggestions="annotator.profanitySuggestions"
            :warnings="annotator.profanityWarnings"
            :error-message="annotator.errorMessage"
            :status-message="annotator.statusMessage"
            @analyze-profanity="annotator.analyzeProfanity"
            @apply-profanity-suggestions="annotator.applyProfanitySuggestions"
            @close="close"
            @discard-profanity-suggestions="annotator.discardProfanitySuggestions"
            @remove-profanity-suggestion="annotator.removeProfanitySuggestion"
            @seek="annotator.seekTo"
            @pick="annotator.selectProfanityPath"
            @options="annotator.updateProfanityOptions"
            @load-tracks="annotator.loadProfanitySubtitleTracks"
            @select-detection="annotator.selectProfanityDetection"
            @review-detection="annotator.reviewProfanityDetection"
            @approve-high-confidence="annotator.approveProfanityBatch()"
            @approve-visible="annotator.approveProfanityBatch"
            @edit-detection="annotator.editProfanityDetection"
            @start-preview="annotator.startProfanityPreview"
            @stop-preview="annotator.stopProfanityPreview"
          />
        </template>
      </MarkersPanel>

      <section class="stage-shell" data-testid="stage-shell">
        <VideoStage
          :active-type="annotator.activeType"
          :active-type-label="annotator.activeTypeLabel"
          :current-time="annotator.currentTime"
          :effective-duration="annotator.effectiveDuration"
          :is-playing="annotator.isPlaying"
          :pending-start="annotator.pendingStart"
          :pending-type="annotator.pendingType"
          :pending-type-label="annotator.pendingTypeLabel"
          :preview-active-type="annotator.previewActiveType"
          :preview-playback-enabled="annotator.previewPlaybackEnabled"
          :register-video-element="annotator.registerVideoElement"
          :sorted-segments="annotator.sortedSegments"
          :video-url="annotator.videoUrl"
          @open-video="annotator.openVideo"
          @loaded-metadata="annotator.handleLoadedMetadata"
          @mark-type-request="handleMarkTypeRequest"
          @time-update="annotator.handleTimeUpdate"
          @play-state-change="annotator.handlePlayStateChange"
          @toggle-preview-playback="annotator.togglePreviewPlayback"
          @toggle-playback="annotator.togglePlayback"
          @seek="annotator.seekBy"
          @seek-to="annotator.seekTo"
          @select-segment="handleTimelineSegmentSelect"
        />
      </section>
    </main>
  </div>
</template>
