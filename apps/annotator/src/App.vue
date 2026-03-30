<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import { onBeforeUnmount, onMounted, proxyRefs, ref, watch } from 'vue';
import AnnotatorTopBar from './components/annotator/top-bar/AnnotatorTopBar.vue';
import MarkersPanel from './components/annotator/markers-panel/MarkersPanel.vue';
import VideoStage from './components/annotator/video-stage/VideoStage.vue';
import { useAnnotatorState } from './composables/useAnnotatorState';

type AnnotatorUiMode = 'media' | 'annotate' | 'export';

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
        :can-analyze-profanity="annotator.canAnalyzeProfanity"
        :can-process-video="annotator.canProcessVideo"
        :current-mode="uiMode"
        :error-message="annotator.errorMessage"
        :input-name="annotator.inputName"
        :is-analyzing-profanity="annotator.isAnalyzingProfanity"
        :is-opening-video="annotator.isOpeningVideo"
        :is-selecting-output-path="annotator.isSelectingOutputPath"
        :is-processing="annotator.isProcessing"
        :marker-count-label="annotator.markerCountLabel"
        :profanity-analysis-capabilities="annotator.profanityAnalysisCapabilities"
        :profanity-analysis-options="annotator.profanityAnalysisOptions"
        :profanity-analysis-progress-percent="annotator.analyzeProfanityProgressPercent"
        :profanity-suggestion-count-label="annotator.profanitySuggestionCountLabel"
        :profanity-suggestions="annotator.profanitySuggestions"
        :output-path="annotator.outputPath"
        :process-progress-percent="annotator.processProgressPercent"
        :pending-start="annotator.pendingStart"
        :pending-type="annotator.pendingType"
        :selection-scroll-key="segmentScrollKey"
        :segment-issues="annotator.segmentIssues"
        :selected-segment-id="annotator.selectedSegmentId"
        :sorted-segments="annotator.sortedSegments"
        :status-message="annotator.statusMessage"
        @active-type-change="handleActiveTypeChange"
        @analyze-profanity="annotator.analyzeProfanity"
        @apply-profanity-suggestions="annotator.applyProfanitySuggestions"
        @change-mode="handleModeChange"
        @discard-profanity-suggestions="annotator.discardProfanitySuggestions"
        @filters-selected="annotator.loadFilterFile"
        @open-video="annotator.openVideo"
        @select-output-path="annotator.selectOutputPath"
        @process-linked-video="annotator.processLinkedVideo"
        @toggle-mark="annotator.toggleMark"
        @seek="annotator.seekTo"
        @select-segment="annotator.selectSegment"
        @update-profanity-allow-remote-subtitles="annotator.updateProfanityAllowRemoteSubtitles"
        @update-profanity-enhanced-mode="annotator.updateProfanityEnhancedMode"
        @update-output-path="handleOutputPathUpdate"
        @update-segment="handleSegmentUpdate"
        @delete-segment="annotator.deleteSegment"
      />

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
