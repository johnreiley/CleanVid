<script setup lang="ts">
import type { FilterType } from '@cleanvid/shared';
import { onBeforeUnmount, onMounted, proxyRefs } from 'vue';
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
    <main class="workspace" data-testid="workspace">
      <MarkersPanel
        :active-type="annotator.activeType"
        :error-message="annotator.errorMessage"
        :marker-count-label="annotator.markerCountLabel"
        :movie-label="annotator.movieTitle || annotator.videoName || 'No video loaded'"
        :pending-start="annotator.pendingStart"
        :pending-type="annotator.pendingType"
        :pending-type-label="annotator.pendingTypeLabel"
        :segment-issues="annotator.segmentIssues"
        :selected-segment-id="annotator.selectedSegmentId"
        :sorted-segments="annotator.sortedSegments"
        :status-message="annotator.statusMessage"
        @active-type-change="handleActiveTypeChange"
        @filters-selected="annotator.loadFilterFile"
        @toggle-mark="annotator.toggleMark"
        @seek="annotator.seekTo"
        @select-segment="annotator.selectSegment"
        @update-segment-type="handleSegmentTypeUpdate"
        @update-segment="handleSegmentUpdate"
        @delete-segment="annotator.deleteSegment"
      />

      <section class="stage-shell" data-testid="stage-shell">
        <AnnotatorTopBar
          :movie-label="annotator.videoName || 'No file loaded'"
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
          :register-video-element="annotator.registerVideoElement"
          :sorted-segments="annotator.sortedSegments"
          :video-url="annotator.videoUrl"
          @loaded-metadata="annotator.handleLoadedMetadata"
          @time-update="annotator.handleTimeUpdate"
          @play-state-change="annotator.handlePlayStateChange"
          @toggle-playback="annotator.togglePlayback"
          @seek="annotator.seekBy"
          @seek-to="annotator.seekTo"
          @video-selected="annotator.loadVideoFile"
        />
      </section>
    </main>
  </div>
</template>
