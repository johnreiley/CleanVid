import type { FilterType, SkpCategory, SkpSeverity } from '@cleanvid/shared';

export interface EditableSegment {
  id: string;
  type: FilterType;
  start: number;
  end: number;
  source?: 'skp';
  category?: SkpCategory | null;
  severity?: SkpSeverity;
  description?: string;
}

export interface SegmentIssue {
  id: string;
  messages: string[];
}
