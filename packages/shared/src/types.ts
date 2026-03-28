export type FilterType = 'mute' | 'skip';

export interface FilterSegment {
  id: string;
  type: FilterType;
  start: number;
  end: number;
}

export interface MovieMetadata {
  title?: string;
  duration: number;
}

export interface FilterFile {
  version: 1;
  movie: MovieMetadata;
  filters: FilterSegment[];
}

export type TimelineSegmentKind = 'keep' | 'mute' | 'skip';

export interface TimelineSegment {
  kind: TimelineSegmentKind;
  start: number;
  end: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface KeptSpan extends TimeRange {
  muteRanges: TimeRange[];
}
