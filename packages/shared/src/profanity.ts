export type ProfanitySuggestionSource = 'embedded' | 'provided';

export type ProfanityAnalysisPhase =
  | 'probe-media'
  | 'extract-embedded-subtitles'
  | 'load-provided-subtitles'
  | 'normalize-text'
  | 'detect-profanity'
  | 'merge-detections'
  | 'done';

export interface TimedTextCue {
  start: number;
  end: number;
  text: string;
}

export interface ProfanitySuggestion {
  id: string;
  start: number;
  end: number;
  snippet: string;
  source: ProfanitySuggestionSource;
  sources?: ProfanitySuggestionSource[];
  matchedTerms: string[];
}

export interface ProfanityAnalysisProgressEvent {
  phase: ProfanityAnalysisPhase;
  message: string;
  percent?: number;
}

export interface ProfanityAnalysisResult {
  suggestions: ProfanitySuggestion[];
  usedSources: ProfanitySuggestionSource[];
  subtitleCueCount: number;
  message: string;
}

const PROFANITY_PATTERNS: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: 'fuck', pattern: /\bfuck(?:er|ers|ing|ed|s)?\b/gi },
  { canonical: 'motherfucker', pattern: /\bmotherfuck(?:er|ers)?\b/gi },
  { canonical: 'shit', pattern: /\b(?:bull)?shit(?:ty|ting|s)?\b/gi },
  { canonical: 'bitch', pattern: /\bbitch(?:es|y)?\b/gi },
  { canonical: 'bastard', pattern: /\bbastard(?:s)?\b/gi },
  { canonical: 'damn', pattern: /\b(?:god)?damn(?:ed|ing)?\b/gi },
  { canonical: 'asshole', pattern: /\basshole(?:s)?\b/gi },
  { canonical: 'ass', pattern: /\bass\b/gi },
  { canonical: 'dick', pattern: /\bdick(?:head|heads|s)?\b/gi },
  { canonical: 'cock', pattern: /\bcock(?:s)?\b/gi },
  { canonical: 'cunt', pattern: /\bcunt(?:s)?\b/gi },
  { canonical: 'pussy', pattern: /\bpuss(?:y|ies)\b/gi },
  { canonical: 'prick', pattern: /\bprick(?:s)?\b/gi },
  { canonical: 'slut', pattern: /\bslut(?:s)?\b/gi },
  { canonical: 'whore', pattern: /\bwhore(?:s)?\b/gi }
];

const START_PADDING_SECONDS = 0.15;
const END_PADDING_SECONDS = 0.25;

function sanitizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeProfanityText(text: string): string {
  return sanitizeWhitespace(
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
      .replace(/^[A-Z][A-Z0-9 .'-]{1,24}:\s*/gm, ' ')
      .replace(/[^a-z0-9'\s-]+/g, ' ')
  );
}

export function extractMatchedProfanityTerms(text: string): string[] {
  const normalized = normalizeProfanityText(text);
  const matches = new Set<string>();

  for (const rule of PROFANITY_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      matches.add(rule.canonical);
    }

    rule.pattern.lastIndex = 0;
  }

  return Array.from(matches).sort();
}

export function subtitlesLookIncomplete(cues: TimedTextCue[], duration: number): boolean {
  if (!Number.isFinite(duration) || duration <= 0 || cues.length === 0) {
    return true;
  }

  const cueDensityPerMinute = cues.length / (duration / 60);

  if (cueDensityPerMinute < 1) {
    return true;
  }

  const sorted = [...cues].sort((left, right) => left.start - right.start || left.end - right.end);

  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index].start - sorted[index - 1].end;

    if (gap >= 180) {
      return true;
    }
  }

  return false;
}

export function buildProfanitySuggestions(
  cues: TimedTextCue[],
  source: ProfanitySuggestionSource
): ProfanitySuggestion[] {
  return cues.flatMap((cue, index) => {
    const matchedTerms = extractMatchedProfanityTerms(cue.text);

    if (matchedTerms.length === 0) {
      return [];
    }

    return [
      {
        id: `${source}-${index}-${Math.round(cue.start * 1000)}`,
        start: cue.start,
        end: cue.end,
        snippet: sanitizeWhitespace(cue.text),
        source,
        sources: [source],
        matchedTerms
      }
    ];
  });
}

export function mergeProfanitySuggestions(
  suggestions: ProfanitySuggestion[],
  duration = Number.POSITIVE_INFINITY
): ProfanitySuggestion[] {
  const normalized = suggestions
    .map((suggestion) => ({
      ...suggestion,
      start: Math.max(0, suggestion.start - START_PADDING_SECONDS),
      end: Math.min(duration, suggestion.end + END_PADDING_SECONDS)
    }))
    .filter((suggestion) => suggestion.end > suggestion.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: ProfanitySuggestion[] = [];

  for (const suggestion of normalized) {
    const previous = merged.at(-1);

    if (previous && suggestion.start <= previous.end) {
      previous.end = Math.max(previous.end, suggestion.end);
      previous.snippet = sanitizeWhitespace(`${previous.snippet} ${suggestion.snippet}`);
      previous.matchedTerms = Array.from(
        new Set([...previous.matchedTerms, ...suggestion.matchedTerms])
      ).sort();
      previous.sources = Array.from(
        new Set([...(previous.sources ?? [previous.source]), ...(suggestion.sources ?? [suggestion.source])])
      ).sort();
      previous.source = previous.sources[0] ?? previous.source;
      continue;
    }

    merged.push({
      ...suggestion,
      matchedTerms: [...suggestion.matchedTerms].sort(),
      sources: [...(suggestion.sources ?? [suggestion.source])].sort()
    });
  }

  return merged.map((suggestion, index) => ({
    ...suggestion,
    id: `suggestion-${index + 1}`
  }));
}
