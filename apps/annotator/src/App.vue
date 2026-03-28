<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import { onBeforeUnmount, onMounted, proxyRefs } from 'vue';
import AnnotatorControlRail from './components/AnnotatorControlRail.vue';
import AnnotatorTopBar from './components/AnnotatorTopBar.vue';
import MarkersPanel from './components/MarkersPanel.vue';
import VideoStage from './components/VideoStage.vue';
import { useAnnotatorState } from './composables/useAnnotatorState';

const annotator = proxyRefs(useAnnotatorState());

function handleActiveTypeChange(value: FilterType) {
  annotator.activeType = value;
}

function handleSegmentTypeUpdate(payload: { id: string; value: FilterType }) {
  annotator.updateSegmentType(payload.id, payload.value);
}

function handleSegmentUpdate(payload: { id: string; field: 'start' | 'end'; value: string }) {
  annotator.updateSegment(payload.id, payload.field, payload.value);
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
    <AnnotatorTopBar
      :marker-count-label="annotator.markerCountLabel"
      :movie-label="annotator.movieTitle || annotator.videoName || 'No file loaded'"
      @video-selected="annotator.loadVideoFile"
      @filters-selected="annotator.loadFilterFile"
      @export="annotator.exportFilters"
    />

    <main class="workspace" data-testid="workspace">
      <VideoStage
        :active-type="annotator.activeType"
        :active-type-label="annotator.activeTypeLabel"
        :current-time="annotator.currentTime"
        :effective-duration="annotator.effectiveDuration"
        :is-playing="annotator.isPlaying"
        :pending-start="annotator.pendingStart"
        :register-video-element="annotator.registerVideoElement"
        :video-url="annotator.videoUrl"
        @loaded-metadata="annotator.handleLoadedMetadata"
        @time-update="annotator.handleTimeUpdate"
        @play-state-change="annotator.handlePlayStateChange"
      />

      <AnnotatorControlRail
        :active-type="annotator.activeType"
        :error-message="annotator.errorMessage"
        :is-playing="annotator.isPlaying"
        :seek-step-seconds="annotator.SEEK_STEP_SECONDS"
        :segment-issue-count="annotator.segmentIssues.length"
        :status-message="annotator.statusMessage"
        @active-type-change="handleActiveTypeChange"
        @toggle-playback="annotator.togglePlayback"
        @seek="annotator.seekBy"
        @mark-start="annotator.markStart"
        @mark-end="annotator.markEnd"
      />

      <MarkersPanel
        :segment-issues="annotator.segmentIssues"
        :sorted-segments="annotator.sortedSegments"
        @seek="annotator.seekTo"
        @update-segment-type="handleSegmentTypeUpdate"
        @update-segment="handleSegmentUpdate"
        @delete-segment="annotator.deleteSegment"
      />
    </main>
  </div>
</template>
