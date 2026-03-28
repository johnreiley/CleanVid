import type { FilterType } from '@cleanvid/shared';

export interface EditableSegment {
  id: string;
  type: FilterType;
  start: number;
  end: number;
}

export interface SegmentIssue {
  id: string;
  messages: string[];
}
