import { FilterValidationError } from './errors.js';
import { normalizeFilters } from './filters.js';
import type { FilterSegment, KeptSpan, TimeRange, TimelineSegment, TimelineSegmentKind } from './types.js';

const EPSILON = 1e-6;

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

function hasOverlap(segment: TimeRange, start: number, end: number): boolean {
  return segment.start < end && segment.end > start;
}

function resolveIntervalKind(filters: FilterSegment[], start: number, end: number): TimelineSegmentKind {
  let hasMute = false;

  for (const filter of filters) {
    if (!hasOverlap(filter, start, end)) {
      continue;
    }

    if (filter.type === 'skip') {
      return 'skip';
    }

    hasMute = true;
  }

  return hasMute ? 'mute' : 'keep';
}

export function buildTimeline(filters: FilterSegment[], duration: number): TimelineSegment[] {
  if (!Number.isFinite(duration) || duration < 0) {
    throw new FilterValidationError('Timeline duration must be a finite number greater than or equal to zero.');
  }

  if (duration === 0) {
    return [];
  }

  const normalized = normalizeFilters(filters, { duration });
  const boundaries = new Set<number>([0, duration]);

  for (const filter of normalized) {
    boundaries.add(filter.start);
    boundaries.add(filter.end);
  }

  const orderedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
  const timeline: TimelineSegment[] = [];

  for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
    const start = orderedBoundaries[index];
    const end = orderedBoundaries[index + 1];

    if (start >= end || nearlyEqual(start, end)) {
      continue;
    }

    const kind = resolveIntervalKind(normalized, start, end);
    const previous = timeline.at(-1);

    if (previous && previous.kind === kind && nearlyEqual(previous.end, start)) {
      previous.end = end;
      continue;
    }

    timeline.push({ kind, start, end });
  }

  return timeline;
}

export function buildKeptSpans(timeline: TimelineSegment[]): KeptSpan[] {
  const spans: KeptSpan[] = [];
  let current: KeptSpan | null = null;

  for (const segment of timeline) {
    if (segment.kind === 'skip') {
      current = null;
      continue;
    }

    if (!current || !nearlyEqual(current.end, segment.start)) {
      current = {
        start: segment.start,
        end: segment.end,
        muteRanges: []
      };
      spans.push(current);
    } else {
      current.end = segment.end;
    }

    if (segment.kind === 'mute') {
      current.muteRanges.push({
        start: segment.start - current.start,
        end: segment.end - current.start
      });
    }
  }

  return spans;
}
