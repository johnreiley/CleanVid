import badWords from './badwords.js';
import { alignTokens } from './profanity-token-alignment.js';

export type ProfanitySuggestionSource = 'embedded' | 'provided' | 'transcript';

export type ProfanityAnalysisPhase =
  | 'probe-media'
  | 'extract-embedded-subtitles'
  | 'load-provided-subtitles'
  | 'load-provided-transcript'
  | 'normalize-text'
  | 'detect-profanity'
  | 'align-sources'
  | 'reconcile-detections'
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

export type SubtitleMode = 'auto' | 'external' | 'none';

export interface ProfanityAnalysisOptions {
  subtitlePath?: string;
  transcriptPath?: string;
  subtitleMode?: SubtitleMode;
  subtitleStreamIndex?: number;
  subtitleOffset?: number;
  estimateMissingWords?: boolean;
  wordPadding?: { before: number; after: number };
}

export interface TimedTranscriptWord extends TimedTextCue {
  id: string;
  probability: number | null;
}

export interface TimedTranscriptSegment extends TimedTextCue {
  id: string;
  words: TimedTranscriptWord[];
}

export type TimingMethod =
  'transcript-word' | 'transcript-segment' | 'context-estimated' | 'subtitle-cue' | 'unresolved' | 'manual';
export type DetectionAgreement = 'both' | 'transcript-only' | 'subtitle-only' | 'conflicting';
export type DetectionConfidence = 'high' | 'medium' | 'low';
export interface MuteRange { start: number; end: number }

export interface ProfanityOccurrence extends MuteRange {
  id: string;
  matchedText: string;
  canonicalTerms: string[];
  source: ProfanitySuggestionSource;
  timingMethod: TimingMethod;
  context: string;
  wordIds?: string[];
  segmentId?: string;
  cueId?: string;
  tokenStart: number;
  tokenEnd: number;
  probability?: number | null;
  hasUnknownProbability?: boolean;
  ambiguousContext?: boolean;
}

export interface ReconciledDetection {
  id: string;
  evidence: ProfanityOccurrence[];
  agreement: DetectionAgreement;
  confidence: DetectionConfidence;
  timingMethod: TimingMethod;
  rawRange: MuteRange | null;
  proposedRange: MuteRange | null;
  needsReview: boolean;
  reviewReasons: string[];
  reviewStatus: 'pending' | 'approved' | 'rejected';
  transcriptProbability?: number | null;
  hasUnknownProbability?: boolean;
  nearbyTranscript?: { before: string; match: string; after: string };
}

export interface SubtitleAlignment {
  status: 'aligned' | 'manual' | 'uncertain' | 'suspect';
  offset: number;
  anchorCount: number;
  message: string;
}

export interface EmbeddedSubtitleTrack {
  index: number;
  language?: string;
  title?: string;
  forced: boolean;
}

export interface ProfanityAnalysisResult {
  detections?: ReconciledDetection[];
  subtitleAlignment?: SubtitleAlignment;
  subtitleTracks?: EmbeddedSubtitleTrack[];
  transcriptDetails?: { fileName: string; model: string; audioStreamIndex: number; completedChunks: number; expectedChunks: number };
  suggestions: ProfanitySuggestion[];
  usedSources: ProfanitySuggestionSource[];
  subtitleCueCount: number;
  transcriptSegmentCount?: number;
  warnings?: string[];
  message: string;
}

type ProfanityPatternRule = { canonical: string; pattern: RegExp };

const BASE_PROFANITY_PATTERNS: ProfanityPatternRule[] = [
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
const GENERATED_PATTERN_WILDCARD = "[a-z0-9']*";

function sanitizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeProfanityDictionaryTerm(term: string): string {
  return sanitizeWhitespace(term.toLowerCase().replace(/[^a-z0-9*'\s-]+/g, ' '));
}

function canonicalizeProfanityDictionaryTerm(term: string): string {
  return sanitizeWhitespace(term.replace(/\*/g, ' ').replace(/[-\s]+/g, ' '));
}

function createProfanityPatternFromDictionaryTerm(term: string): ProfanityPatternRule | null {
  const normalizedTerm = normalizeProfanityDictionaryTerm(term);
  const canonical = canonicalizeProfanityDictionaryTerm(normalizedTerm);
  const alphaNumericLength = canonical.replace(/[^a-z0-9]/g, '').length;

  if (canonical === '' || alphaNumericLength < 3) {
    return null;
  }

  const tokens = normalizedTerm.match(/[a-z0-9']+|\*+|[\s-]+/g);

  if (!tokens || tokens.length === 0) {
    return null;
  }

  const patternSource = tokens
    .map((token) => {
      if (/^\*+$/.test(token)) {
        return GENERATED_PATTERN_WILDCARD;
      }

      if (/^[\s-]+$/.test(token)) {
        return '[\\s-]+';
      }

      return escapeRegexLiteral(token);
    })
    .join('');

  return {
    canonical,
    pattern: new RegExp(`\\b${patternSource}\\b`, 'gi')
  };
}

function createSupplementalProfanityPatterns(dictionary: Record<string, number>): ProfanityPatternRule[] {
  const seen = new Set<string>();
  const patterns: ProfanityPatternRule[] = [];

  for (const term of Object.keys(dictionary)) {
    const rule = createProfanityPatternFromDictionaryTerm(term);

    if (!rule) {
      continue;
    }

    const cacheKey = `${rule.canonical}:${rule.pattern.source}`;

    if (seen.has(cacheKey)) {
      continue;
    }

    seen.add(cacheKey);
    patterns.push(rule);
  }

  return patterns;
}

const PROFANITY_PATTERNS: ProfanityPatternRule[] = [
  ...BASE_PROFANITY_PATTERNS,
  ...createSupplementalProfanityPatterns(badWords as Record<string, number>)
];

const PROFANITY_NORMALIZATION_RULES = [
  /<[^>]+>/g,
  /\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g,
  /^[A-Z][A-Z0-9 .'-]{1,24}:\s*/gim,
  /[^a-z0-9'\s-]+/g,
  /\s+/g
];

export function normalizeProfanityText(text: string): string {
  return PROFANITY_NORMALIZATION_RULES.reduce(
    (value, rule) => value.replace(rule, ' '),
    text.toLowerCase().replaceAll('’', "'")
  ).trim();
}

function findProfanityMatches(normalized: string) {
  return PROFANITY_PATTERNS.flatMap(({ canonical, pattern }) =>
    Array.from(normalized.matchAll(pattern), (match) => ({
      canonical,
      start: match.index,
      end: match.index + match[0].length
    }))
  );
}

export function profanityTokens(text: string) {
  return Array.from(text.matchAll(/[a-z0-9]+(?:'[a-z0-9]+)*/g), (match) => ({
    text: match[0], start: match.index, end: match.index + match[0].length
  }));
}

function occurrenceSpans(text: string) {
  const spans: { start: number; end: number; terms: string[] }[] = [];
  const matches = findProfanityMatches(text).sort((a, b) => a.start - b.start || b.end - a.end);
  for (const match of matches) {
    const previous = spans.at(-1);
    if (previous && match.start < previous.end) {
      previous.end = Math.max(previous.end, match.end);
      if (!previous.terms.includes(match.canonical)) previous.terms.push(match.canonical);
    } else {
      spans.push({ start: match.start, end: match.end, terms: [match.canonical] });
    }
  }
  const tokens = profanityTokens(text);
  return spans.map(({ start, end, terms }) => ({
    start, end, canonicalTerms: terms.sort(),
    matchedText: text.slice(start, end),
    tokenStart: tokens.findIndex((token) => token.end > start),
    tokenEnd: tokens.filter((token) => token.start < end).length
  }));
}

export function detectSubtitleOccurrences(
  cues: TimedTextCue[], source: 'embedded' | 'provided'
): ProfanityOccurrence[] {
  return cues.flatMap((cue, index) => occurrenceSpans(normalizeProfanityText(cue.text)).map((span) => ({
    ...span,
    id: `${source}-${index}-${span.tokenStart}`,
    start: cue.start,
    end: cue.end,
    source,
    cueId: String(index),
    timingMethod: 'subtitle-cue',
    context: cue.text
  })));
}

export function detectTranscriptOccurrences(segments: TimedTranscriptSegment[]): ProfanityOccurrence[] {
  return segments.flatMap((segment, segmentIndex) => {
    const { text, wordIndexes } = normalizeTimedWords(segment);
    const wordContext = text.trim();
    const context = normalizeProfanityText(segment.text) || wordContext;
    const matches = occurrenceSpans(text).flatMap((span): ProfanityOccurrence[] => {
      const indexes = wordIndexes.slice(span.start, span.end).filter((index) => index >= 0);
      if (!indexes.length) return [];
      const words = segment.words.slice(indexes[0], indexes.at(-1)! + 1);
      const known = words.flatMap((word) => word.probability === null ? [] : [word.probability]);
      const start = Math.min(...words.map((word) => word.start));
      const end = Math.max(...words.map((word) => word.end));
      return [{
        ...span, id: `transcript-${segmentIndex}-word-${span.tokenStart}`, source: 'transcript',
        start, end, timingMethod: end > start ? 'transcript-word' : 'unresolved',
        wordIds: words.map((word) => word.id), segmentId: segment.id, context: wordContext,
        probability: known.length ? Math.min(...known) : null,
        hasUnknownProbability: known.length !== words.length
      }];
    });

    if (context === wordContext) return matches;
    const segmentSpans = occurrenceSpans(context);
    if (!segmentSpans.length) return matches;

    // Positional alignment identifies which repeated occurrence has word timing.
    // A count is only used for occurrences whose positions are still ambiguous.
    const tokenKeys = (value: string) => profanityTokens(value).map(({ text: key }) => ({ key }));
    const alignment = alignTokens(tokenKeys(context), tokenKeys(wordContext));
    const represented = new Set<number>();
    const consumed = new Set<string>();
    const timedByPosition = new Map(matches.map((match) => [match.tokenStart, match]));
    for (const span of segmentSpans) {
      const mapped = alignment.unique.slice(span.tokenStart, span.tokenEnd);
      const match = timedByPosition.get(mapped[0]);
      if (match && match.tokenEnd - match.tokenStart === mapped.length &&
        mapped.every((index, i) => index === mapped[0] + i)) {
        represented.add(span.tokenStart);
        consumed.add(match.id);
      }
    }
    const remaining = new Map<string, number>();
    const ambiguousTerms = new Set<string>();
    for (const match of matches) {
      if (consumed.has(match.id)) continue;
      remaining.set(match.matchedText, (remaining.get(match.matchedText) ?? 0) + 1);
      ambiguousTerms.add(match.matchedText);
    }
    for (const span of segmentSpans) {
      if (represented.has(span.tokenStart)) continue;
      const existing = remaining.get(span.matchedText) ?? 0;
      if (existing > 0) {
        remaining.set(span.matchedText, existing - 1);
        continue;
      }
      matches.push({
        ...span, id: `transcript-${segmentIndex}-segment-${span.tokenStart}`, source: 'transcript',
        start: segment.start, end: segment.end,
        timingMethod: segment.end > segment.start ? 'transcript-segment' : 'unresolved',
        segmentId: segment.id, context, probability: null, hasUnknownProbability: true,
        ambiguousContext: ambiguousTerms.has(span.matchedText)
      });
    }
    return matches;
  });
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

export function timedTranscriptTokens(segment: TimedTranscriptSegment) {
  const { text, wordIndexes } = normalizeTimedWords(segment);
  return profanityTokens(text).flatMap((token) => {
    const indexes = wordIndexes.slice(token.start, token.end).filter((index) => index >= 0);
    if (!indexes.length) return [];
    const words = segment.words.slice(indexes[0], indexes.at(-1)! + 1);
    return [{
      key: token.text,
      wordIds: words.map((word) => word.id),
      start: Math.min(...words.map((word) => word.start)),
      end: Math.max(...words.map((word) => word.end))
    }];
  });
}

function normalizeTimedWords(segment: TimedTextCue & { words: TimedTextCue[] }) {
  let text = '';
  let wordIndexes: number[] = [];
  const preserveSpacing = segment.words.map((word) => word.text).join('').trim() === segment.text.trim();

  segment.words.forEach((word, index) => {
    // MTS includes spacing in word text, but the contract does not require it.
    if (!preserveSpacing && /[\p{L}\p{N}]$/u.test(text.slice(-2)) && /^[\p{L}\p{N}]/u.test(word.text)) {
      text += ' ';
      wordIndexes.push(-1);
    }
    const lower = word.text.toLowerCase().replaceAll('’', "'");
    text += lower;
    for (let offset = 0; offset < lower.length; offset += 1) {
      wordIndexes.push(index);
    }
  });

  const trimmed = text.trimStart();
  wordIndexes = wordIndexes.slice(text.length - trimmed.length);
  text = trimmed;

  // Carry word provenance through the same replacements used for subtitle matching.
  for (const rule of PROFANITY_NORMALIZATION_RULES) {
    const nextIndexes: number[] = [];
    let cursor = 0;
    text = text.replace(rule, (match: string, index: number) => {
      for (; cursor < index; cursor += 1) {
        nextIndexes.push(wordIndexes[cursor]);
      }
      nextIndexes.push(-1);
      cursor += match.length;
      return ' ';
    });
    for (; cursor < wordIndexes.length; cursor += 1) {
      nextIndexes.push(wordIndexes[cursor]);
    }
    wordIndexes = nextIndexes;
  }

  return { text, wordIndexes };
}

export function buildTranscriptProfanitySuggestions(
  segments: Array<TimedTextCue & { words: TimedTextCue[] }>
): { suggestions: ProfanitySuggestion[]; warnings: string[] } {
  const suggestions: ProfanitySuggestion[] = [];
  const pointMatches = new Set<string>();
  let segmentFallbackCount = 0;

  function addMatch(start: number, end: number, snippet: string, terms: string[]) {
    if (end === start) {
      pointMatches.add(`${terms.join(', ')} at ${start.toFixed(3)}s`);
      return;
    }
    suggestions.push({
      id: `transcript-${suggestions.length + 1}`,
      start,
      end,
      snippet: sanitizeWhitespace(snippet),
      source: 'transcript',
      sources: ['transcript'],
      matchedTerms: terms
    });
  }

  for (const segment of segments) {
    const { text, wordIndexes } = normalizeTimedWords(segment);
    const represented = new Map<string, Set<string>>();
    for (const match of findProfanityMatches(text)) {
      const indexes = wordIndexes.slice(match.start, match.end).filter((index) => index >= 0);
      if (indexes.length === 0) {
        continue;
      }
      const matchedWords = segment.words.slice(indexes[0], indexes.at(-1)! + 1);
      const occurrences = represented.get(match.canonical) ?? new Set<string>();
      const occurrence = `${match.start}:${match.end}`;
      if (occurrences.has(occurrence)) {
        continue;
      }
      occurrences.add(occurrence);
      represented.set(match.canonical, occurrences);
      addMatch(
        matchedWords.reduce((start, word) => Math.min(start, word.start), Infinity),
        matchedWords.reduce((end, word) => Math.max(end, word.end), 0),
        matchedWords.map((word) => word.text.trim()).join(' '),
        [match.canonical]
      );
    }

    const segmentText = normalizeProfanityText(segment.text.trim());
    if (segmentText !== text.trim()) {
      const occurrences = new Map<string, Set<string>>();
      for (const match of findProfanityMatches(segmentText)) {
        const spans = occurrences.get(match.canonical) ?? new Set<string>();
        spans.add(`${match.start}:${match.end}`);
        occurrences.set(match.canonical, spans);
      }
      const missing = [...occurrences]
        .filter(([term, spans]) => spans.size > (represented.get(term)?.size ?? 0))
        .map(([term]) => term)
        .sort();
      if (missing.length > 0) {
        segmentFallbackCount += 1;
        addMatch(segment.start, segment.end, segment.text, missing);
      }
    }
  }

  const warnings: string[] = [];
  if (segmentFallbackCount > 0) {
    warnings.push(`Used segment timestamps where word timing was missing in ${segmentFallbackCount} transcript segment(s).`);
  }
  if (pointMatches.size > 0) {
    const examples = [...pointMatches].slice(0, 5).join('; ');
    warnings.push(`Review ${pointMatches.size} zero-duration transcript match(es) manually; no mute range was created: ${examples}${pointMatches.size > 5 ? '; and more' : ''}.`);
  }
  return { suggestions, warnings };
}

export function mergeProfanitySuggestions(
  suggestions: ProfanitySuggestion[],
  duration = Number.POSITIVE_INFINITY
): ProfanitySuggestion[] {
  const normalized = suggestions
    .map((suggestion) => ({
      ...suggestion,
      start: Math.max(0, suggestion.start - (suggestion.source === 'transcript' ? 0 : START_PADDING_SECONDS)),
      end: Math.min(duration, suggestion.end + (suggestion.source === 'transcript' ? 0 : END_PADDING_SECONDS))
    }))
    .filter((suggestion) => suggestion.end > suggestion.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: ProfanitySuggestion[] = [];

  for (const suggestion of normalized) {
    const previous = merged.at(-1);

    if (previous && suggestion.start <= previous.end) {
      const nestedTranscriptSnippet = previous.source === 'transcript' && suggestion.source === 'transcript' &&
        suggestion.end <= previous.end && previous.snippet.includes(suggestion.snippet);
      if (!nestedTranscriptSnippet) {
        previous.snippet = sanitizeWhitespace(`${previous.snippet} ${suggestion.snippet}`);
      }
      previous.end = Math.max(previous.end, suggestion.end);
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
