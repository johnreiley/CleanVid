import {
  detectSubtitleOccurrences, detectTranscriptOccurrences, normalizeProfanityText, profanityTokens, timedTranscriptTokens,
  type MuteRange, type ProfanityOccurrence, type ReconciledDetection, type SubtitleAlignment,
  type TimedTextCue, type TimedTranscriptSegment, type TimingMethod
} from './profanity.js';
import { alignTokens, MAX_LOCAL_TOKENS } from './profanity-token-alignment.js';

const ANCHOR_LENGTH = 4;
const DEFAULT_MARGIN = 3;
const MAX_CUE_ERROR = 0.85;
const CONTRACTIONS: Record<string, string[]> = {
  "can't": ['can', 'not'], "cannot": ['can', 'not'], "won't": ['will', 'not'],
  "i'm": ['i', 'am'], "it's": ['it', 'is'], "that's": ['that', 'is'], "what's": ['what', 'is'],
  "let's": ['let', 'us']
};

function tokenParts(text: string): string[] {
  if (CONTRACTIONS[text]) return CONTRACTIONS[text];
  const suffix = /^(.+)(n't|'re|'ve|'ll)$/.exec(text);
  if (!suffix) return [text.replaceAll("'", '')];
  const expansions: Record<string, string> = { "n't": 'not', "'re": 'are', "'ve": 'have', "'ll": 'will' };
  return [suffix[1], expansions[suffix[2]]];
}

function alignmentTokens(text: string) {
  return profanityTokens(normalizeProfanityText(text.replaceAll('’', "'")))
    .flatMap(({ text: token }, position) => tokenParts(token).map((key) => ({ key, position })));
}

interface WordToken extends MuteRange { key: string; wordIds: string[] }

class TimeIndex<T extends MuteRange> {
  readonly items: T[];
  private readonly leafCount: number;
  private readonly maxEnd: Float64Array;

  constructor(items: T[]) {
    this.items = [...items].sort((a, b) => a.start - b.start);
    this.leafCount = 2 ** Math.ceil(Math.log2(Math.max(1, items.length)));
    this.maxEnd = new Float64Array(2 * this.leafCount).fill(-Infinity);
    this.items.forEach((item, index) => { this.maxEnd[this.leafCount + index] = item.end; });
    for (let node = this.leafCount - 1; node > 0; node--) {
      this.maxEnd[node] = Math.max(this.maxEnd[node * 2], this.maxEnd[node * 2 + 1]);
    }
  }

  within(start: number, end: number): T[] {
    const result: T[] = [];
    const visit = (node: number, left: number, right: number) => {
      if (this.maxEnd[node] < start || left >= this.items.length || this.items[left].start > end ||
        result.length > MAX_LOCAL_TOKENS) return;
      if (right - left === 1) {
        result.push(this.items[left]);
        return;
      }
      const middle = (left + right) >>> 1;
      visit(node * 2, left, middle);
      visit(node * 2 + 1, middle, right);
    };
    visit(1, 0, this.leafCount);
    return result;
  }
}

function anchorKeys(tokens: { key: string }[]) {
  const keys: string[] = [];
  for (let i = 0; i <= tokens.length - ANCHOR_LENGTH; i++) {
    keys.push(tokens.slice(i, i + ANCHOR_LENGTH).map((token) => token.key).join(' '));
  }
  return keys;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
}

function distanceToCue(anchor: MuteRange, cue: MuteRange, offset: number) {
  return Math.max(0, cue.start + offset - anchor.start, anchor.end - cue.end - offset);
}

function measureAlignment(
  cues: TimedTextCue[], words: WordToken[], duration: number, manualOffset?: number
): SubtitleAlignment {
  const wordPhrases = new Map<string, MuteRange | null>();
  anchorKeys(words).forEach((key, index) => {
    const first = words[index];
    const last = words[index + ANCHOR_LENGTH - 1];
    if (last.end - first.start > 8) return;
    wordPhrases.set(key, wordPhrases.has(key) ? null : { start: first.start, end: last.end });
  });

  const cuePhrases = cues.map((cue) => anchorKeys(alignmentTokens(cue.text)));
  const frequency = new Map<string, number>();
  for (const keys of cuePhrases) {
    for (const key of keys) frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }
  const anchors = cues.flatMap((cue, i) => {
    const times = cuePhrases[i].flatMap((key) => {
      const match = wordPhrases.get(key);
      return match && frequency.get(key) === 1 ? [match] : [];
    });
    if (!times.length) return [];
    const range = { start: Math.min(...times.map((time) => time.start)), end: Math.max(...times.map((time) => time.end)) };
    return [{ cue, range, offset: (range.start + range.end - cue.start - cue.end) / 2 }];
  });

  const anchorCount = anchors.length;
  const measured = anchorCount ? median(anchors.map((anchor) => anchor.offset)) : 0;
  const fitsWithoutOffset = anchors.filter(({ cue, range }) => distanceToCue(range, cue, 0) <= 0.35);
  const offset = manualOffset ?? (Math.abs(measured) > 0.35 && fitsWithoutOffset.length < anchorCount * 0.8
    ? Math.round(measured * 100) / 100 : 0);
  const fits = anchors.filter(({ cue, range }) => distanceToCue(range, cue, offset) <= MAX_CUE_ERROR);
  const bins = new Map<number, typeof anchors>();
  for (const anchor of anchors) {
    const bin = Math.floor(anchor.cue.start / Math.max(10, duration / 5));
    const group = bins.get(bin) ?? [];
    group.push(anchor);
    bins.set(bin, group);
  }
  const binOffsets = [...bins.values()].filter((group) => group.length >= 2)
    .map((group) => median(group.map((anchor) => anchor.offset)));
  const drift = Math.max(...binOffsets) - Math.min(...binOffsets) > 1.5;
  const cut = [...bins.values()].some((group) => group.length >= 2 &&
    group.filter(({ cue, range }) => distanceToCue(range, cue, offset) > MAX_CUE_ERROR).length / group.length > 0.5);
  if (anchorCount >= 3 && (drift || cut || fits.length / anchorCount < 0.8)) {
    return { status: 'suspect', offset: manualOffset ?? 0, anchorCount,
      message: 'Dialogue anchors disagree on subtitle timing. Check for drift, a different cut, or an incorrect offset.' };
  }

  const times = fits.map(({ cue }) => cue.start);
  if (manualOffset === undefined &&
    (fits.length < 3 || Math.max(...times) - Math.min(...times) < Math.min(60, duration * 0.25))) {
    return { status: 'uncertain', offset: 0, anchorCount,
      message: 'Too few distinctive dialogue anchors were found across the video to verify subtitle timing.' };
  }
  return { status: manualOffset === undefined ? 'aligned' : 'manual', offset, anchorCount,
    message: manualOffset === undefined ? 'Subtitle timing verified using dialogue anchors.' : 'Using the manually entered subtitle offset.' };
}

type Padding = { before: number; after: number };

export function padProfanityRange(
  range: MuteRange | null, method: TimingMethod, duration: number, wordPadding: Padding = { before: 0, after: 0 }
): MuteRange | null {
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) ||
    range.end <= range.start || range.end <= 0 || range.start >= duration) return null;
  const padding = method === 'subtitle-cue' ? { before: 0.15, after: 0.25 }
    : method === 'context-estimated' ? { before: 0.15, after: 0.15 }
      : method === 'transcript-word' ? wordPadding : { before: 0, after: 0 };
  const start = Math.max(0, range.start - padding.before);
  const end = Math.min(duration, range.end + padding.after);
  return end > start ? { start, end } : null;
}

export function mergeApprovedProfanityRanges(ranges: MuteRange[], mergeTouching = false): MuteRange[] {
  const sorted = ranges.filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MuteRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && (last.end > range.start || (mergeTouching && last.end === range.start))) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

interface ReconcileOptions {
  cues: TimedTextCue[];
  subtitleSource: 'embedded' | 'provided';
  segments: TimedTranscriptSegment[];
  hasTranscript: boolean;
  duration: number;
  subtitleOffset?: number;
  estimateMissingWords?: boolean;
  wordPadding?: Padding;
  searchMargin?: number;
  lowProbability?: number;
  validationWarnings?: string[];
  onReconcile?: () => void;
}

interface Candidate {
  subtitle: ProfanityOccurrence;
  transcript?: ProfanityOccurrence;
  conflicting: boolean;
  ambiguousWords?: string[];
  estimated?: MuteRange;
  nearbyTranscript?: ReconciledDetection['nearbyTranscript'];
}

function tokenSpan(tokens: { position: number }[], occurrence: ProfanityOccurrence) {
  const first = tokens.findIndex(({ position }) => position >= occurrence.tokenStart);
  const length = tokens.filter(({ position }) => position >= occurrence.tokenStart && position < occurrence.tokenEnd).length;
  return { first, length };
}

function sameText(a: ProfanityOccurrence, b: ProfanityOccurrence) {
  return alignmentTokens(a.matchedText).map((token) => token.key).join(' ') ===
    alignmentTokens(b.matchedText).map((token) => token.key).join(' ');
}

function matchingSegment(
  subtitle: ProfanityOccurrence, cue: MuteRange, tokens: ReturnType<typeof alignmentTokens>,
  left: number, length: number, segments: ProfanityOccurrence[]
) {
  if (segments.length > MAX_LOCAL_TOKENS) return [];
  return segments.filter((segment) => {
    if (segment.ambiguousContext || !sameText(subtitle, segment) || segment.end < cue.start || segment.start > cue.end) return false;
    const segmentTokens = alignmentTokens(segment.context);
    const span = tokenSpan(segmentTokens, segment);
    const { unique, count } = alignTokens(tokens, segmentTokens);
    return count >= length + 2 && count >= tokens.length * 0.6 && span.length === length &&
      unique.slice(left, left + length).every((index, i) => index === span.first + i);
  });
}

function findCueCandidates(
  cue: TimedTextCue, occurrences: ProfanityOccurrence[], words: WordToken[],
  byWordId: Map<string, ProfanityOccurrence[]>, segmentMatches: ProfanityOccurrence[],
  synchronized: boolean, estimate: boolean
): Candidate[] {
  const tokens = alignmentTokens(cue.text);
  const alignment = alignTokens(tokens, words);

  return occurrences.map((subtitle) => {
    const { first, length } = tokenSpan(tokens, subtitle);
    if (first < 0 || !length) return { subtitle, conflicting: false };
    const after = first + length;
    const mapped = alignment.unique.slice(first, after);
    const beforeIndex = alignment.unique[first - 1] ?? -1;
    const afterIndex = alignment.unique[after] ?? -1;
    const wordIndexes = alignment.positions.slice(first, after).flat();
    const nearCue = (word: MuteRange) => distanceToCue(word, cue, 0) <= MAX_CUE_ERROR;
    const mappedWords = mapped.flatMap((index) => index < 0 ? [] : [words[index]]);
    const contextMatches = alignment.unique.filter((index, i) =>
      index >= 0 && (i < first || i >= after) && nearCue(words[index])).length;
    const enoughContext = contextMatches >= 2 && alignment.count >= tokens.length * 0.6;
    const ids = [...new Set(mappedWords.flatMap((word) => word.wordIds))];
    const wordOptions = (byWordId.get(ids[0]) ?? []).filter((match) => sameText(subtitle, match) &&
      match.wordIds?.length === ids.length && match.wordIds.every((id, i) => id === ids[i]) && nearCue(match));
    const word = enoughContext && mappedWords.length === length &&
      mapped.every((index, i) => index === mapped[0] + i) && wordOptions.length === 1 ? wordOptions[0] : undefined;
    const fallback = synchronized && !word
      ? matchingSegment(subtitle, cue, tokens, first, length, segmentMatches)
      : [];
    const transcript = synchronized ? word ?? (fallback.length === 1 ? fallback[0] : undefined) : undefined;

    const bracketed = enoughContext && beforeIndex >= 0 && afterIndex > beforeIndex &&
      nearCue(words[beforeIndex]) && nearCue(words[afterIndex]);
    const missing = wordIndexes.length === 0 && bracketed && afterIndex === beforeIndex + 1;
    const substitution = wordIndexes.length === 0 && bracketed && afterIndex > beforeIndex + 1;
    const ambiguous = synchronized && !transcript && (wordIndexes.some((index) => nearCue(words[index])) || fallback.length > 1);
    const gap = bracketed ? { start: words[beforeIndex].end, end: words[afterIndex].start } : undefined;
    const plausible = gap && gap.end - gap.start >= 0.1 - 1e-9 && gap.end - gap.start <= 1.5 + 1e-9;
    const estimated = estimate && synchronized && length === 1 && plausible &&
      ((!transcript && missing) || (transcript?.timingMethod === 'unresolved' && afterIndex === beforeIndex + 2))
      ? gap : undefined;

    const firstWord = mapped[0] >= 0 ? mapped[0] : beforeIndex + 1;
    const lastWord = mapped.at(-1)! >= 0 ? mapped.at(-1)! + 1 : afterIndex >= 0 ? afterIndex : firstWord;
    const text = (start: number, end: number) => words.slice(start, end).map(({ key }) => key).join(' ');
    const ambiguousWords = ambiguous ? [...new Set(wordIndexes.flatMap((index) => words[index].wordIds))]
      .flatMap((id) => (byWordId.get(id) ?? []).filter((match) => sameText(subtitle, match) && nearCue(match)).map((match) => match.id))
      : undefined;
    return {
      subtitle, transcript, estimated, ambiguousWords, conflicting: !transcript && (ambiguous || (synchronized && substitution)),
      nearbyTranscript: words.length ? {
        before: text(Math.max(0, firstWord - 6), firstWord),
        match: text(firstWord, lastWord),
        after: text(lastWord, lastWord + 6)
      } : undefined
    };
  });
}

export function reconcileProfanity(options: ReconcileOptions): {
  detections: ReconciledDetection[];
  subtitleAlignment?: SubtitleAlignment;
  warnings: string[];
} {
  const { cues, segments, duration, subtitleSource, hasTranscript, validationWarnings = [] } = options;
  const subtitles = detectSubtitleOccurrences(cues, subtitleSource);
  const transcript = detectTranscriptOccurrences(segments);
  const dual = cues.length > 0 && hasTranscript;
  const warnings: string[] = [];
  const fallbackCount = new Set(transcript.filter((item) => !item.wordIds).map((item) => item.segmentId)).size;
  const pointCount = transcript.filter((item) => item.timingMethod === 'unresolved').length;
  if (fallbackCount) warnings.push(`Used segment timestamps where word timing was missing in ${fallbackCount} transcript segment(s).`);
  if (pointCount) warnings.push(`Review ${pointCount} zero-duration transcript match(es) manually. Some may require a new mute range.`);

  const byWordId = new Map<string, ProfanityOccurrence[]>();
  for (const occurrence of transcript) {
    const first = occurrence.wordIds?.[0];
    if (first === undefined) continue;
    const matches = byWordId.get(first) ?? [];
    matches.push(occurrence);
    byWordId.set(first, matches);
  }

  let subtitleAlignment: SubtitleAlignment | undefined;
  let outOfBoundsCues = 0;
  let candidates: Candidate[] = subtitles.map((subtitle) => ({ subtitle, conflicting: false }));
  if (dual) {
    const words = new TimeIndex(segments.flatMap((segment) => timedTranscriptTokens(segment).flatMap(
      (token) => tokenParts(token.key).map((key) => ({ ...token, key }))
    )));
    const fallback = new TimeIndex(transcript.filter((item) => !item.wordIds));
    subtitleAlignment = measureAlignment(cues, words.items, duration, options.subtitleOffset);
    if (subtitleAlignment.status === 'suspect' || subtitleAlignment.status === 'uncertain') {
      warnings.push(subtitleAlignment.message);
    }
    const synchronized = subtitleAlignment.status === 'aligned' || subtitleAlignment.status === 'manual';
    const byCue = new Map<string, ProfanityOccurrence[]>();
    for (const occurrence of subtitles) {
      const group = byCue.get(occurrence.cueId!) ?? [];
      group.push(occurrence);
      byCue.set(occurrence.cueId!, group);
    }
    const offset = subtitleAlignment.offset;
    outOfBoundsCues = cues.filter((cue) => cue.start + offset >= duration || cue.end + offset <= 0).length;
    if (outOfBoundsCues) warnings.push(`${outOfBoundsCues} subtitle cue(s) fall outside the video at the selected offset.`);
    const margin = options.searchMargin ?? DEFAULT_MARGIN;
    candidates = [];
    for (const [cueId, occurrences] of byCue) {
      const original = cues[Number(cueId)];
      const cue = { ...original, start: original.start + offset, end: original.end + offset };
      candidates.push(...findCueCandidates(cue, occurrences, words.within(cue.start - margin, cue.end + margin),
        byWordId, fallback.within(cue.start, cue.end), synchronized && cue.start < duration && cue.end > 0,
        options.estimateMissingWords !== false));
    }
  }

  options.onReconcile?.();
  const claims = new Map<string, number>();
  for (const { transcript: word } of candidates) {
    if (word) claims.set(word.id, (claims.get(word.id) ?? 0) + 1);
  }
  const paired = new Set<string>();
  const conflictingTranscript = new Set(candidates.flatMap((candidate) => candidate.ambiguousWords ?? []));
  // Reject crossings between non-overlapping cues. Overlapping cues have no
  // reliable order outside each cue's own token alignment.
  const proposed = candidates.filter((candidate) => candidate.transcript);
  const byStart = [...proposed].sort((a, b) => a.subtitle.start - b.subtitle.start);
  const byEnd = [...proposed].sort((a, b) => a.subtitle.end - b.subtitle.end);
  const crossings = new Set<Candidate>();
  let i = 0;
  let latest: Candidate | undefined;
  for (const current of byStart) {
    while (i < byEnd.length && byEnd[i].subtitle.end <= current.subtitle.start) {
      const earlier = byEnd[i++];
      if (!latest || earlier.transcript!.start > latest.transcript!.start) latest = earlier;
    }
    if (latest && latest.transcript!.start > current.transcript!.start) {
      crossings.add(latest);
      crossings.add(current);
    }
  }

  function detection(candidate: Candidate | undefined, word?: ProfanityOccurrence): ReconciledDetection {
    const subtitle = candidate?.subtitle;
    const evidence = [subtitle, word].filter((item): item is ProfanityOccurrence => Boolean(item));
    const conflicting = candidate?.conflicting || (word && conflictingTranscript.has(word.id));
    const agreement = conflicting ? 'conflicting' : subtitle && word ? 'both' : word ? 'transcript-only' : 'subtitle-only';
    const suspect = subtitleAlignment?.status === 'suspect';
    const offset = subtitleAlignment?.offset ?? 0;
    const reasons: string[] = [];
    let method: TimingMethod = word?.timingMethod ?? 'unresolved';
    let rawRange = word && word.end > word.start ? { start: word.start, end: word.end } : null;
    if (!rawRange && candidate?.estimated) {
      method = 'context-estimated';
      rawRange = candidate.estimated;
      reasons.push('Estimated from surrounding words. Check whether the word was spoken and verify the timing.');
    }
    if (!rawRange && subtitle && !suspect) {
      method = 'subtitle-cue';
      rawRange = { start: subtitle.start + offset, end: subtitle.end + offset };
      reasons.push('The range covers the entire subtitle cue.');
    }
    const proposedRange = padProfanityRange(rawRange, method, duration, dual ? options.wordPadding : undefined);
    if (!proposedRange) {
      method = 'unresolved';
      reasons.push('Enter a playable start and end time.');
    }
    if (conflicting) {
      reasons.push('The dialogue differs or more than one alignment is possible.');
    }
    if (word && word.timingMethod === 'unresolved') reasons.push('The transcript match has zero duration.');
    if (method === 'transcript-segment') reasons.push('Only transcript segment timestamps are available.');
    if (dual && word && !subtitle) reasons.push('No reliable subtitle match was found.');
    if (word?.probability != null && word.probability < (options.lowProbability ?? 0.6)) {
      reasons.push('One or more transcript words have low recognition probability.');
    }
    if (validationWarnings.length || (subtitle && outOfBoundsCues)) reasons.push('Check the source validation and coverage warnings.');
    if (subtitle && subtitleAlignment?.status === 'uncertain') reasons.push('Subtitle timing could not be verified.');
    if (suspect) reasons.push('Subtitle synchronization is suspect.');
    const confidence = conflicting || (subtitle && suspect)
      ? 'low' : agreement === 'both' && (method === 'transcript-word' || method === 'transcript-segment')
        ? 'high' : method === 'transcript-word' || method === 'context-estimated' ? 'medium' : 'low';
    const needsReview = dual ? reasons.length > 0 || confidence !== 'high' : !proposedRange || Boolean(
      word && (method !== 'transcript-word' || reasons.length > 0)
    );
    return {
      id: (subtitle ?? word)!.id, evidence, agreement, confidence, timingMethod: method,
      rawRange, proposedRange, needsReview, reviewReasons: reasons,
      reviewStatus: !dual && !needsReview ? 'approved' : 'pending',
      transcriptProbability: word?.probability, hasUnknownProbability: word?.hasUnknownProbability,
      nearbyTranscript: candidate?.nearbyTranscript
    };
  }

  const detections = candidates.map((candidate) => {
    const word = candidate.transcript;
    if (word && (claims.get(word.id)! > 1 || crossings.has(candidate) || conflictingTranscript.has(word.id))) {
      conflictingTranscript.add(word.id);
      return detection({ ...candidate, conflicting: true, estimated: undefined });
    }
    if (word) paired.add(word.id);
    return detection(candidate, word);
  });
  for (const word of transcript) {
    if (!paired.has(word.id)) detections.push(detection(undefined, word));
  }
  detections.sort((a, b) => (a.rawRange?.start ?? a.evidence[0].start) - (b.rawRange?.start ?? b.evidence[0].start));
  return { detections, subtitleAlignment, warnings };
}
