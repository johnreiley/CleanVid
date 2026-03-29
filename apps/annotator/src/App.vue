<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import { onBeforeUnmount, onMounted, proxyRefs, ref } from 'vue';
import AnnotatorTopBar from './components/AnnotatorTopBar.vue';
import MarkersPanel from './components/MarkersPanel.vue';
import VideoStage from './components/VideoStage.vue';
import { useAnnotatorState } from './composables/useAnnotatorState';

const annotator = proxyRefs(useAnnotatorState());
const segmentScrollKey = ref(0);

function handleActiveTypeChange(value: FilterType) {
  annotator.activeType = value;
}

function handleSegmentUpdate(payload: { id: string; field: 'start' | 'end'; value: string }) {
  annotator.updateSegment(payload.id, payload.field, payload.value);
}

function handleOutputPathUpdate(value: string) {
  annotator.updateOutputPath(value);
}

function handleTimelineSegmentSelect(id: string) {
  annotator.selectSegment(id);
  segmentScrollKey.value += 1;
}

onMounted(() => {
  window.addEventListener('keydown', annotator.handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', annotator.handleKeydown);
  annotator.cleanup();
});
</script>

<template>
  <div class="app-shell">
    <main class="workspace" data-testid="workspace">
      <MarkersPanel
        :active-type="annotator.activeType"
        :can-process-video="annotator.canProcessVideo"
        :error-message="annotator.errorMessage"
        :is-opening-video="annotator.isOpeningVideo"
        :is-processing="annotator.isProcessing"
        :marker-count-label="annotator.markerCountLabel"
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
        @filters-selected="annotator.loadFilterFile"
        @open-video="annotator.openVideo"
        @process-linked-video="annotator.processLinkedVideo"
        @toggle-mark="annotator.toggleMark"
        @seek="annotator.seekTo"
        @select-segment="annotator.selectSegment"
        @update-output-path="handleOutputPathUpdate"
        @update-segment="handleSegmentUpdate"
        @delete-segment="annotator.deleteSegment"
      />

      <section class="stage-shell" data-testid="stage-shell">
        <AnnotatorTopBar
          :movie-label="annotator.inputName || 'No file loaded'"
          @export="annotator.exportFilters"
        />

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
