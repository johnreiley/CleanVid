import type { FilterType, SkpCategory, SkpSeverity } from '@cleanvid/shared';

export interface EditableSegment {
  id: string;
  type: FilterType;
  start: number;
  end: number;
  source?: 'filters-object' | 'skp';
  category?: SkpCategory | string | null;
  severity?: SkpSeverity;
  description?: string;
}

export interface SegmentIssue {
  id: string;
  messages: string[];
}
