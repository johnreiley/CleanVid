import { describe, expect, it } from 'vitest';
import {
  FilterValidationError,
  buildProfanitySuggestions,
  buildKeptSpans,
  extractMatchedProfanityTerms,
  buildTimeline,
  mergeProfanitySuggestions,
  normalizeFilters,
  parseFilterFile,
  parseSkpFile,
  parseSvgRectImport,
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
  it('detects punctuation-heavy and mixed-case subtitle edge cases', () => {
    expect(extractMatchedProfanityTerms('Oh, my God!')).toEqual(
      expect.arrayContaining(['oh my god'])
    );
    expect(extractMatchedProfanityTerms('DEAR... LORD?!')).toEqual(
      expect.arrayContaining(['dear lord'])
    );
    expect(extractMatchedProfanityTerms('mother-fucker')).toEqual(
      expect.arrayContaining(['mother fucker'])
    );
  });

  it('detects supplemental profanity terms from the bad word dictionary', () => {
    expect(extractMatchedProfanityTerms('That fuckin scene had a blow-job gag.')).toEqual(
      expect.arrayContaining(['blow job', 'fuckin'])
    );
  });

  it('detects spaced-out dictionary variants after normalization', () => {
    expect(extractMatchedProfanityTerms('Why would you say f u c k e r on air?')).toEqual(
      expect.arrayContaining(['f u c k e r'])
    );
  });

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
        source: 'provided',
        matchedTerms: ['shit']
      }
    ]);

    expect(merged).toEqual([
      expect.objectContaining({
        id: 'suggestion-1',
        source: 'embedded',
        sources: ['embedded', 'provided'],
        matchedTerms: ['damn', 'shit']
      })
    ]);
  });
});

describe('skp parsing', () => {
  it('parses basic mute and skip entries with severity and category mapping', () => {
    const parsed = parseSkpFile(`
00:01:23.456 - 00:01:28.900
Profanity mute 3

00:02:00.000 - 00:02:04.250
Violence skip 2
`);

    expect(parsed.skippedEntryCount).toBe(0);
    expect(parsed.segments).toEqual([
      {
        id: 'skp-1',
        start: 83.456,
        end: 88.9,
        type: 'mute',
        category: 'profanity',
        severity: 3,
        description: 'Profanity'
      },
      {
        id: 'skp-2',
        start: 120,
        end: 124.25,
        type: 'skip',
        category: 'violence',
        severity: 2,
        description: 'Violence'
      }
    ]);
  });

  it('maps imported filter types from label text instead of trusting the raw skp action token', () => {
    const parsed = parseSkpFile(`
00:00:10.000 - 00:00:12.000
Audio distortion skip 2

00:00:14.000 - 00:00:16.000
Drugs mute 2

00:00:18.000 - 00:00:20.000
Strange clown imagery mute 1
`);

    expect(parsed.segments).toEqual([
      expect.objectContaining({
        description: 'Audio distortion',
        category: 'audio',
        type: 'mute'
      }),
      expect.objectContaining({
        description: 'Drugs',
        category: 'drugs',
        type: 'skip'
      }),
      expect.objectContaining({
        description: 'Strange clown imagery',
        category: 'other',
        type: 'skip'
      })
    ]);
  });

  it('parses arrow-separated skp entries with category severity and parenthetical descriptions', () => {
    const parsed = parseSkpFile(`
0:23:13.63 --> 0:23:44.84
sex 2 (intercourse)

0:24:36.08 --> 0:24:40.58
nudity 2 (topless woman)

1:14:48.72 --> 1:15:13.72
nudity 2 (2 naked people talking)

1:15:41.6 --> 1:16:19.65
sex 2 (intercourse)
`);

    expect(parsed.skippedEntryCount).toBe(0);
    expect(parsed.segments).toEqual([
      expect.objectContaining({
        start: 1393.63,
        end: 1424.84,
        category: 'sex',
        type: 'skip',
        severity: 2,
        description: 'intercourse'
      }),
      expect.objectContaining({
        start: 1476.08,
        end: 1480.58,
        category: 'nude',
        type: 'skip',
        severity: 2,
        description: 'topless woman'
      }),
      expect.objectContaining({
        start: 4488.72,
        end: 4513.72,
        category: 'nude',
        type: 'skip',
        severity: 2,
        description: '2 naked people talking'
      }),
      expect.objectContaining({
        start: 4541.6,
        end: 4579.65,
        category: 'sex',
        type: 'skip',
        severity: 2,
        description: 'intercourse'
      })
    ]);
  });

  it('ignores disabled entries and normalizes nudity labels', () => {
    const parsed = parseSkpFile(`
//00:03:00.000 - 00:03:05.000
//Violence skip 3

00:04:00.000 - 00:04:02.500
Brief nudity skip 1
`);

    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0]).toEqual(
      expect.objectContaining({
        category: 'nude',
        description: 'Brief nudity'
      })
    );
  });

  it('tolerates unsupported extra lines between entries', () => {
    const parsed = parseSkpFile(`
00:01:00.000 - 00:01:03.000
Gore skip 3
blur:10,20,30,40
screenshot:data

00:01:05.000 - 00:01:06.000
Drugs mute 2
`);

    expect(parsed.segments.map((segment) => segment.description)).toEqual(['Gore', 'Drugs']);
  });

  it('keeps valid entries and reports malformed ones', () => {
    const parsed = parseSkpFile(`
00:01:00.000 - 00:01:03.000
Violence skip 3

00:01:10.000 - 00:01:12.000
MissingSeverity mute

00:01:20.000 - 00:01:21.000
Language mute 1
`);

    expect(parsed.segments).toHaveLength(2);
    expect(parsed.skippedEntryCount).toBe(1);
    expect(parsed.warnings[0]).toContain('line 5');
  });

  it('rejects files with no valid entries', () => {
    expect(() =>
      parseSkpFile(`
00:01:00.000 - 00:01:03.000
Broken label
`)
    ).toThrowError(FilterValidationError);
  });
});

describe('svg rect import parsing', () => {
  it('parses rect segments relative to the loaded movie duration', () => {
    const parsed = parseSvgRectImport(
      `<svg><rect class="backdrop"></rect><g><rect x="10%" width="5%" class="cuts"></rect><rect x="25%" width="2.5%" class="cuts"></rect></g></svg>`,
      {
        duration: 200,
        type: 'mute'
      }
    );

    expect(parsed).toEqual([
      { type: 'mute', start: 20, end: 30 },
      { type: 'mute', start: 50, end: 55 }
    ]);
  });

  it('ignores non-cut rects and merges overlapping or duplicate imported ranges', () => {
    const parsed = parseSvgRectImport(
      `<svg><rect class="backdrop" x="0%" width="100%"></rect><rect class="cuts secondary" x="10%" width="5%"></rect><rect class="cuts" x="12%" width="3%"></rect><rect class="cuts" x="12%" width="3%"></rect></svg>`,
      {
        duration: 100,
        type: 'skip'
      }
    );

    expect(parsed).toEqual([{ type: 'skip', start: 10, end: 15 }]);
  });

  it('supports decimal percentages and clamps segments to the media duration', () => {
    const parsed = parseSvgRectImport(
      `<svg><rect class="cuts" x="99.5%" width="4.25%"></rect></svg>`,
      {
        duration: 80,
        type: 'mute'
      }
    );

    expect(parsed).toEqual([{ type: 'mute', start: 79.6, end: 80 }]);
  });

  it('rejects empty input invalid svg and unusable cuts', () => {
    expect(() =>
      parseSvgRectImport('', {
        duration: 100,
        type: 'mute'
      })
    ).toThrowError(FilterValidationError);

    expect(() =>
      parseSvgRectImport('<svg><rect class="cuts"', {
        duration: 100,
        type: 'mute'
      })
    ).toThrowError(FilterValidationError);

    expect(() =>
      parseSvgRectImport('<svg><rect class="backdrop" x="10%" width="5%"></rect></svg>', {
        duration: 100,
        type: 'mute'
      })
    ).toThrowError(FilterValidationError);
  });

  it('rejects zero-duration imports', () => {
    expect(() =>
      parseSvgRectImport('<svg><rect class="cuts" x="10%" width="5%"></rect></svg>', {
        duration: 0,
        type: 'mute'
      })
    ).toThrowError(FilterValidationError);
  });
});
