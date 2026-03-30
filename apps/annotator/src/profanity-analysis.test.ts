import { describe, expect, it, vi } from 'vitest';
import type { TimedTextCue } from '@cleanvid/shared';
import { analyzeProfanity, type AnalyzeProfanityDependencies } from './profanity-analysis.js';

function createDependencies(
  overrides: Partial<AnalyzeProfanityDependencies> = {}
): AnalyzeProfanityDependencies {
  return {
    probeSubtitleStreams: async () => ({
      duration: 600,
      streams: []
    }),
    extractEmbeddedSubtitleCues: async () => null,
    loadProvidedSubtitleCues: async () => null,
    ...overrides
  };
}

function createCue(start: number, end: number, text: string): TimedTextCue {
  return { start, end, text };
}

describe('analyzeProfanity', () => {
  it('uses embedded subtitles when they are available', async () => {
    const loadProvidedSubtitleCues = vi.fn(async () => [createCue(20, 21, 'should not run')]);

    const result = await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie'
      },
      createDependencies({
        probeSubtitleStreams: async () => ({
          duration: 20,
          streams: [{ index: 2, codec_type: 'subtitle', codec_name: 'subrip' }]
        }),
        extractEmbeddedSubtitleCues: async () => [createCue(15, 16, 'oh shit')],
        loadProvidedSubtitleCues
      })
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        source: 'embedded',
        matchedTerms: ['shit']
      })
    ]);
    expect(loadProvidedSubtitleCues).not.toHaveBeenCalled();
  });

  it('uses a provided subtitle file when one is selected', async () => {
    const loadProvidedSubtitleCues = vi.fn(async () => [createCue(20, 21, 'what the fuck')]);

    const result = await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie',
        subtitlePath: 'C:\\Subtitles\\movie.srt'
      },
      createDependencies({
        loadProvidedSubtitleCues
      })
    );

    expect(loadProvidedSubtitleCues).toHaveBeenCalledWith('C:\\Subtitles\\movie.srt');
    expect(result.usedSources).toEqual(['provided']);
  });

  it('throws a clear error when no usable subtitles are available', async () => {
    await expect(
      analyzeProfanity(
        {
          inputPath: 'C:\\Movies\\movie.mp4',
          movieTitle: 'movie'
        },
        createDependencies()
      )
    ).rejects.toThrow(
      'No usable subtitles were found. Choose an .srt, .vtt, or .ass subtitle file and try again.'
    );
  });

  it('merges subtitle profanity into draft mute suggestions', async () => {
    const result = await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie'
      },
      createDependencies({
        extractEmbeddedSubtitleCues: async () => [
          createCue(10, 11, 'damn'),
          createCue(11.05, 12, 'shit')
        ]
      })
    );

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.matchedTerms).toEqual(['damn', 'shit']);
  });
});
