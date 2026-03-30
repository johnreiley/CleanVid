import { describe, expect, it } from 'vitest';
import {
  FilterValidationError,
  buildProfanitySuggestions,
  buildKeptSpans,
  buildTimeline,
  mergeProfanitySuggestions,
  normalizeFilters,
  parseFilterFile,
  subtitlesLookIncomplete,
  serializeFilterFile
} from './index.js';

describe('filter validation', () => {
  it('parses a valid filter file and sorts the filters', () => {
    const parsed = parseFilterFile({
      version: 1,
      movie: {
        title: 'Example',
        duration: 120
      },
      filters: [
        { id: 'b', type: 'skip', start: 50, end: 60 },
        { id: 'a', type: 'mute', start: 10, end: 20 }
      ]
    });

    expect(parsed.filters.map((segment) => segment.id)).toEqual(['a', 'b']);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      normalizeFilters([
        { id: 'dup', type: 'mute', start: 1, end: 2 },
        { id: 'dup', type: 'skip', start: 3, end: 4 }
      ])
    ).toThrowError(FilterValidationError);
  });

  it('rejects invalid time ranges', () => {
    expect(() =>
      parseFilterFile({
        version: 1,
        movie: { duration: 30 },
        filters: [{ id: 'bad', type: 'mute', start: 10, end: 10 }]
      })
    ).toThrow('start < end');
  });

  it('drops filters that clamp entirely outside the media duration', () => {
    const normalized = normalizeFilters(
      [
        { id: 'inside', type: 'mute', start: 5, end: 8 },
        { id: 'outside', type: 'skip', start: 40, end: 50 }
      ],
      { duration: 10 }
    );

    expect(normalized.map((segment) => segment.id)).toEqual(['inside']);
  });

  it('serializes normalized JSON with a trailing newline', () => {
    const output = serializeFilterFile({
      version: 1,
      movie: { title: 'Example', duration: 30 },
      filters: [
        { id: 'b', type: 'skip', start: 20, end: 25 },
        { id: 'a', type: 'mute', start: 5, end: 10 }
      ]
    });

    expect(output).toContain('"version": 1');
    expect(output.endsWith('\n')).toBe(true);
    expect(output.indexOf('"a"')).toBeLessThan(output.indexOf('"b"'));
  });
});

describe('timeline planning', () => {
  it('applies skip precedence over mute and returns disjoint intervals', () => {
    const timeline = buildTimeline(
      [
        { id: 'mute-1', type: 'mute', start: 10, end: 20 },
        { id: 'skip-1', type: 'skip', start: 15, end: 18 }
      ],
      30
    );

    expect(timeline).toEqual([
      { kind: 'keep', start: 0, end: 10 },
      { kind: 'mute', start: 10, end: 15 },
      { kind: 'skip', start: 15, end: 18 },
      { kind: 'mute', start: 18, end: 20 },
      { kind: 'keep', start: 20, end: 30 }
    ]);
  });

  it('collapses adjacent intervals and builds kept spans with relative mute ranges', () => {
    const timeline = buildTimeline(
      [
        { id: 'mute-1', type: 'mute', start: 5, end: 10 },
        { id: 'mute-2', type: 'mute', start: 10, end: 15 },
        { id: 'skip-1', type: 'skip', start: 20, end: 25 }
      ],
      30
    );

    expect(timeline).toEqual([
      { kind: 'keep', start: 0, end: 5 },
      { kind: 'mute', start: 5, end: 15 },
      { kind: 'keep', start: 15, end: 20 },
      { kind: 'skip', start: 20, end: 25 },
      { kind: 'keep', start: 25, end: 30 }
    ]);

    expect(buildKeptSpans(timeline)).toEqual([
      {
        start: 0,
        end: 20,
        muteRanges: [{ start: 5, end: 15 }]
      },
      {
        start: 25,
        end: 30,
        muteRanges: []
      }
    ]);
  });
});

describe('profanity analysis helpers', () => {
  it('creates profanity suggestions from normalized cue text', () => {
    const suggestions = buildProfanitySuggestions(
      [
        { start: 10, end: 11, text: '[MUSIC] This is bullshit.' },
        { start: 12, end: 13, text: 'Nothing to flag here.' }
      ],
      'embedded'
    );

    expect(suggestions).toEqual([
      expect.objectContaining({
        start: 10,
        end: 11,
        source: 'embedded',
        matchedTerms: ['shit'],
        snippet: '[MUSIC] This is bullshit.'
      })
    ]);
  });

  it('merges overlapping profanity suggestions after padding', () => {
    const merged = mergeProfanitySuggestions([
      {
        id: 'one',
        start: 5,
        end: 5.4,
        snippet: 'damn',
        source: 'embedded',
        matchedTerms: ['damn']
      },
      {
        id: 'two',
        start: 5.45,
        end: 5.8,
        snippet: 'shit',
        source: 'whisper-tiny',
        matchedTerms: ['shit']
      }
    ]);

    expect(merged).toEqual([
      expect.objectContaining({
        id: 'suggestion-1',
        source: 'embedded',
        sources: ['embedded', 'whisper-tiny'],
        matchedTerms: ['damn', 'shit']
      })
    ]);
  });

  it('detects incomplete subtitles from sparse cues or large gaps', () => {
    expect(
      subtitlesLookIncomplete(
        [
          { start: 0, end: 2, text: 'hello' },
          { start: 300, end: 302, text: 'world' }
        ],
        600
      )
    ).toBe(true);

    expect(
      subtitlesLookIncomplete(
        Array.from({ length: 120 }, (_, index) => ({
          start: index * 5,
          end: index * 5 + 2,
          text: `cue ${index}`
        })),
        600
      )
    ).toBe(false);
  });
});
