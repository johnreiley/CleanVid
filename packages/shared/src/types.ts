export type FilterType = 'mute' | 'skip';

export interface FilterSegment {
  id: string;
  type: FilterType;
  start: number;
  end: number;
}

export type FiltersObjectSourceType = 'audio' | 'audiovisual';

export interface FiltersObjectTag {
  id: string;
  sourceId: string;
  refId: string | null;
  tagSetId: string | null;
  categoryId: string | null;
  description: string;
  sourceType: FiltersObjectSourceType;
  type: FilterType;
  start: number;
  end: number;
  locked: boolean;
  categoryPath: string[];
}

export interface FiltersObjectCategory {
  id: string;
  key: string;
  title: string;
  defaultType: string | null;
  parentId: string | null;
  iconUrl: string | null;
  whiteIconUrl: string | null;
  locked: boolean;
  tags: FiltersObjectTag[];
  childCategories: FiltersObjectCategory[];
}

export interface FiltersObjectParseResult {
  categories: FiltersObjectCategory[];
  tags: FiltersObjectTag[];
  skippedTagCount: number;
  warnings: string[];
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
