import type {
  EmbeddedSubtitleTrack, MuteRange, ProfanityAnalysisOptions, ProfanityAnalysisResult, ReconciledDetection
} from '@cleanvid/shared';

export interface ProfanityDraft extends ReconciledDetection {
  editedRange?: MuteRange;
  applied?: boolean;
}

export interface ProfanityReviewState {
  options: ProfanityAnalysisOptions;
  detections: ProfanityDraft[] | null;
  selectedId: string | null;
  tracks: EmbeddedSubtitleTrack[];
  result: ProfanityAnalysisResult | null;
  isSelectingFile: boolean;
  isLoadingTracks: boolean;
}
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
