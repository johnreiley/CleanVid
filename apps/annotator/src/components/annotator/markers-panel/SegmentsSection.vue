<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { EditableSegment, SegmentIssue } from '../../../annotator-types';
import PhWind from '@phosphor-icons-vue-icons/PhWind.vue.mjs';
import SegmentCard from './SegmentCard.vue';

const emit = defineEmits<{
  deleteSegment: [id: string];
  seek: [start: number];
  selectSegment: [id: string];
  updateSegment: [payload: { id: string; field: 'start' | 'end'; value: string }];
}>();

defineProps<{
  registerSegmentCard: (id: string, element: Element | ComponentPublicInstance | null) => void;
  segmentIssues: SegmentIssue[];
  selectedSegmentId: string | null;
  sortedSegments: EditableSegment[];
}>();
</script>

<template>
  <section class="segments-shell" data-testid="segments-section-content">
    <div class="sidebar-section-heading">
      <h2>Filter timeline</h2>
    </div>

    <div v-if="segmentIssues.length > 0" class="validation-summary" data-testid="validation-summary">
      <strong>{{ segmentIssues.length }} issue{{ segmentIssues.length === 1 ? '' : 's' }}</strong>
      <ul>
        <li v-for="issue in segmentIssues" :key="issue.id">
          {{ issue.id }}: {{ issue.messages.join(' ') }}
        </li>
      </ul>
    </div>

    <div v-if="sortedSegments.length === 0" class="segments-empty">
      <PhWind :size="32" />
      <p>Timeline is empty</p>
    </div>

    <ul v-else class="segment-list" data-testid="segment-list">
      <SegmentCard
        v-for="segment in sortedSegments"
        :key="segment.id"
        :ref="(element) => registerSegmentCard(segment.id, element)"
        :segment="segment"
        :selected="selectedSegmentId === segment.id"
        @delete-segment="emit('deleteSegment', $event)"
        @seek="emit('seek', $event)"
        @select-segment="emit('selectSegment', $event)"
        @update-segment="emit('updateSegment', $event)"
      />
    </ul>
  </section>
</template>
