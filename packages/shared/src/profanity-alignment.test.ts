import { describe, expect, it } from 'vitest';
import { mergeApprovedProfanityRanges, reconcileProfanity } from './profanity-alignment.js';
import type { TimedTextCue, TimedTranscriptSegment } from './profanity.js';

function segment(start: number, text: string, id = String(start)): TimedTranscriptSegment {
  const words = text.split(' ').map((word, index) => ({
    id: `${id}-${index}`, text: word,
    start: Number((start + index * 0.3).toFixed(2)),
    end: Number((start + index * 0.3 + 0.2).toFixed(2)),
    probability: 0.9 as number | null
  }));
  return { id, start, end: words.at(-1)!.end, text, words };
}

const anchorSegments = [
  segment(6, 'Quiet trains crossed the wooden bridge'),
  segment(24, 'Fresh fruit filled the wicker basket'),
  segment(65, 'Purple orchids grew beside northern windows')
];
const anchorCues = anchorSegments.map(({ start, end, text }) => ({ start: start - 0.1, end: end + 0.1, text }));
const line = (text: string): TimedTextCue => ({ start: 39, end: 43, text });

function dual(cues: TimedTextCue[], segments: TimedTranscriptSegment[], overrides: Partial<Parameters<typeof reconcileProfanity>[0]> = {}) {
  return reconcileProfanity({
    cues: [...anchorCues, ...cues], segments: [...anchorSegments, ...segments],
    duration: 80, hasTranscript: true, subtitleSource: 'provided', ...overrides
  });
}

describe('dual-source profanity reconciliation', () => {
  it('keeps the transcript interval and pads it exactly once when requested', () => {
    const text = 'What the hell was that';
    const spoken = segment(40, text);
    const result = dual([line(text)], [spoken]);
    expect(result.subtitleAlignment).toMatchObject({ status: 'aligned', offset: 0, anchorCount: 4 });
    expect(result.detections).toEqual([expect.objectContaining({
      agreement: 'both', confidence: 'high', needsReview: false, reviewStatus: 'pending',
      rawRange: { start: 40.6, end: 40.8 }, proposedRange: { start: 40.6, end: 40.8 },
      evidence: [expect.objectContaining({ start: 39, end: 43 }), expect.objectContaining({ wordIds: ['40-2'] })]
    })]);
    const padded = dual([line(text)], [spoken], { wordPadding: { before: 0.1, after: 0.2 } });
    expect(padded.detections[0].proposedRange).toEqual({ start: 40.5, end: 41 });
    expect(mergeApprovedProfanityRanges([padded.detections[0].proposedRange!, { start: 41, end: 42 }]))
      .toEqual([{ start: 40.5, end: 41 }, { start: 41, end: 42 }]);
  });

  it('uses context and order to pair one of two repeated terms without reusing the same word', () => {
    const result = dual([line('Damn we should go then damn start running now')], [
      segment(40, 'We should go then damn start running now')
    ]);
    expect(result.detections).toHaveLength(2);
    expect(result.detections.map((item) => item.agreement)).toEqual(['subtitle-only', 'both']);
    expect(result.detections[1].proposedRange).toEqual({ start: 41.2, end: 41.4 });
    expect(result.detections[0].evidence).toHaveLength(1);
  });

  it('keeps ambiguous repetitions and competing overlapping cues from claiming corroboration', () => {
    const result = dual([line('Oh damn damn please come back')], [segment(40, 'Oh damn please come back')]);
    expect(result.detections).toHaveLength(3);
    expect(result.detections.every(({ agreement, needsReview }) => agreement === 'conflicting' && needsReview)).toBe(true);

    const overlapping = dual([
      line('Oh damn please come back'),
      { start: 40, end: 42, text: 'Oh damn please come back' }
    ], [segment(40, 'Oh damn please come back')]);
    expect(overlapping.detections).toHaveLength(3);
    expect(overlapping.detections.every(({ agreement }) => agreement !== 'both')).toBe(true);
  });

  it('keeps distinct occurrences in a cue and in transcript-only dialogue independently reviewable', () => {
    const result = dual([line('Oh damn over here and shit over there right now')], [
      segment(40, 'Oh damn over here and shit over there right now'),
      segment(52, 'What the fuck is going on')
    ]);
    expect(result.detections.map(({ agreement, proposedRange }) => [agreement, proposedRange])).toEqual([
      ['both', { start: 40.3, end: 40.5 }],
      ['both', { start: 41.5, end: 41.7 }],
      ['transcript-only', { start: 52.6, end: 52.8 }]
    ]);
  });

  it('estimates a missing word from ordered adjacent anchors and makes review mandatory', () => {
    const text = 'What the hell was that noise';
    const spoken = segment(40, 'What the was that noise');
    spoken.words[1].end = 40.45;
    spoken.words[2].start = 40.8;
    const result = dual([line(text)], [spoken]);
    expect(result.detections[0]).toMatchObject({
      agreement: 'subtitle-only', timingMethod: 'context-estimated', confidence: 'medium',
      needsReview: true, reviewStatus: 'pending', rawRange: { start: 40.45, end: 40.8 }
    });
    expect(result.detections[0].proposedRange?.start).toBeCloseTo(40.3);
    expect(result.detections[0].proposedRange?.end).toBeCloseTo(40.95);
    expect(dual([line(text)], [spoken], { estimateMissingWords: false }).detections[0].timingMethod).toBe('subtitle-cue');
  });

  it('uses a broad cue for overlapping anchors, substitutions, and unrelated dialogue', () => {
    const cue = line('What the hell was that noise');
    const overlapping = segment(40, 'What the was that noise');
    overlapping.words[1].end = 40.7;
    const missing = dual([cue], [overlapping]).detections[0];
    expect(missing).toMatchObject({ timingMethod: 'subtitle-cue', needsReview: true, proposedRange: { start: 38.85, end: 43.25 } });
    expect(dual([cue], [segment(40, 'What the heck was that noise')]).detections[0])
      .toMatchObject({ agreement: 'conflicting', timingMethod: 'subtitle-cue', confidence: 'low' });
    expect(dual([cue], [segment(40, 'Please put your coat on')]).detections[0].timingMethod).toBe('subtitle-cue');
  });

  it('aligns contractions and preserves the phrase span and nullable probabilities', () => {
    const spoken = segment(40, 'No I can not say oh my god out loud');
    spoken.words[5].probability = 0.5;
    spoken.words[6].probability = null;
    const result = dual([line("No I can't say oh my god out loud")], [spoken]);
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]).toMatchObject({
      agreement: 'both', confidence: 'high', needsReview: true, transcriptProbability: 0.5,
      hasUnknownProbability: true, proposedRange: { start: 41.5, end: 42.3 },
      evidence: [expect.objectContaining({ canonicalTerms: ['god', 'oh my god'] }),
        expect.objectContaining({ wordIds: ['40-5', '40-6', '40-7'] })]
    });
  });

  it('labels segment fallback and preserves zero-duration matches', () => {
    const fallback = segment(40, 'Oh damn please come back');
    fallback.words = [];
    const result = dual([line(fallback.text)], [fallback]);
    expect(result.detections[0]).toMatchObject({
      agreement: 'both', timingMethod: 'transcript-segment', confidence: 'high', needsReview: true,
      proposedRange: { start: fallback.start, end: fallback.end }, transcriptProbability: null
    });
    const point = segment(52, 'Damn');
    point.words[0].end = point.words[0].start;
    point.words[0].probability = null;
    expect(dual([], [point]).detections[0]).toMatchObject({
      timingMethod: 'unresolved', reviewStatus: 'pending', proposedRange: null, transcriptProbability: null
    });
  });

  it('uses dialogue to distinguish a repeated term with missing timing from its timed counterpart', () => {
    const spoken = segment(40, 'Oh damn we can go then damn we can stay');
    spoken.words.splice(1, 1);
    const result = dual([line(spoken.text)], [spoken]);
    expect(result.detections.map(({ agreement, timingMethod }) => [agreement, timingMethod])).toEqual([
      ['both', 'transcript-segment'], ['both', 'transcript-word']
    ]);
    expect(result.detections[0].evidence.find(({ source }) => source === 'transcript')?.tokenStart).toBe(1);
  });

  it('applies a consistent offset and withholds high confidence for drift or insufficient anchors', () => {
    const spoken = segment(40, 'What the hell was that');
    const offset = 2.5;
    const cues = [...anchorCues, { ...spoken, start: 39.9, end: spoken.end + 0.1 }];
    const shifted = cues.map((cue) => ({ ...cue, start: cue.start - offset, end: cue.end - offset }));
    const aligned = dual([], [spoken], { cues: shifted });
    expect(aligned.subtitleAlignment).toMatchObject({ status: 'aligned', offset });
    expect(aligned.detections[0]).toMatchObject({ agreement: 'both', proposedRange: { start: 40.6, end: 40.8 } });

    const drifted = dual([], [spoken], { cues: shifted.map((cue, i) => i === 2 ? { ...cue, start: cue.start - 8, end: cue.end - 8 } : cue) });
    expect(drifted.subtitleAlignment).toMatchObject({ status: 'suspect', offset: 0 });
    expect(drifted.detections.some(({ agreement }) => agreement === 'both')).toBe(false);
    expect(drifted.detections.find(({ agreement }) => agreement === 'subtitle-only')?.proposedRange).toBeNull();

    const uncertain = dual([], [spoken], { cues: [line(spoken.text)] });
    expect(uncertain.subtitleAlignment).toMatchObject({ status: 'uncertain' });
    const manual = dual([], [spoken], { cues: [line(spoken.text)], subtitleOffset: 0 });
    expect(manual.subtitleAlignment).toMatchObject({ status: 'manual' });
    expect(manual.detections[0].agreement).toBe('both');
  });

  it('blocks bulk eligibility when source identity or coverage warnings are present', () => {
    const text = 'What the hell was that';
    const result = dual([line(text)], [segment(40, text)], { validationWarnings: ['Transcript coverage is incomplete.'] });
    expect(result.detections[0]).toMatchObject({ confidence: 'high', needsReview: true });
  });
});
