import { describe, expect, it, vi } from 'vitest';
import type { ProfanityAnalysisCapabilities, TimedTextCue } from '@cleanvid/shared';
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
    fetchRemoteSubtitleCues: async () => null,
    transcribeWithWhisper: async () => [
      {
        start: 10,
        end: 11,
        text: 'This is bullshit'
      }
    ],
    getCapabilities: () =>
      ({
        remoteSubtitlesAvailable: true,
        whisperBaseAvailable: true,
        whisperTinyAvailable: true
      }) satisfies ProfanityAnalysisCapabilities,
    ...overrides
  };
}

function createCue(start: number, end: number, text: string): TimedTextCue {
  return { start, end, text };
}

describe('analyzeProfanity', () => {
  it('uses embedded subtitles first without base fallback', async () => {
    const transcribeWithWhisper = vi.fn(async () => {
      throw new Error('should not run');
    });

    const result = await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie',
        options: {
          enhancedMode: false,
          allowRemoteSubtitles: false
        }
      },
      createDependencies({
        probeSubtitleStreams: async () => ({
          duration: 20,
          streams: [{ index: 2, codec_type: 'subtitle', codec_name: 'subrip' }]
        }),
        extractEmbeddedSubtitleCues: async () => [createCue(15, 16, 'oh shit')],
        transcribeWithWhisper
      })
    );

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        source: 'embedded',
        matchedTerms: ['shit']
      })
    ]);
    expect(transcribeWithWhisper).not.toHaveBeenCalled();
  });

  it('uses remote subtitles when embedded subtitles are unavailable and remote fetch is enabled', async () => {
    const fetchRemoteSubtitleCues = vi.fn(async () => [createCue(20, 21, 'what the fuck')]);

    const result = await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie',
        options: {
          enhancedMode: false,
          allowRemoteSubtitles: true
        }
      },
      createDependencies({
        fetchRemoteSubtitleCues
      })
    );

    expect(fetchRemoteSubtitleCues).toHaveBeenCalledTimes(1);
    expect(result.remoteLookupUsed).toBe(true);
    expect(result.usedSources).toContain('remote');
  });

  it('falls back to whisper base when no subtitles are usable', async () => {
    const transcribeWithWhisper = vi.fn(async (_inputPath, model: 'tiny' | 'base') => [
      createCue(40, 41, model === 'base' ? 'damn' : 'should not use tiny')
    ]);

    const result = await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie',
        options: {
          enhancedMode: false,
          allowRemoteSubtitles: false
        }
      },
      createDependencies({
        transcribeWithWhisper
      })
    );

    expect(transcribeWithWhisper).toHaveBeenCalledWith('C:\\Movies\\movie.mp4', 'base');
    expect(result.usedSources).toEqual(['whisper-base']);
  });

  it('runs whisper tiny refinement when enhanced mode is enabled', async () => {
    const transcribeWithWhisper = vi.fn(async () => [createCue(25, 26, 'bitch')]);

    const result = await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie',
        options: {
          enhancedMode: true,
          allowRemoteSubtitles: false
        }
      },
      createDependencies({
        probeSubtitleStreams: async () => ({
          duration: 120,
          streams: [{ index: 2, codec_type: 'subtitle', codec_name: 'subrip' }]
        }),
        extractEmbeddedSubtitleCues: async () => [createCue(10, 11, 'mild line')],
        transcribeWithWhisper
      })
    );

    expect(transcribeWithWhisper).toHaveBeenCalledWith('C:\\Movies\\movie.mp4', 'tiny');
    expect(result.whisperRefinementApplied).toBe(true);
    expect(result.usedSources).toContain('whisper-tiny');
  });

  it('runs whisper tiny refinement automatically when subtitles look incomplete', async () => {
    const transcribeWithWhisper = vi.fn(async () => [createCue(300, 301, 'damn')]);

    await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie',
        options: {
          enhancedMode: false,
          allowRemoteSubtitles: false
        }
      },
      createDependencies({
        probeSubtitleStreams: async () => ({
          duration: 600,
          streams: [{ index: 2, codec_type: 'subtitle', codec_name: 'subrip' }]
        }),
        extractEmbeddedSubtitleCues: async () => [createCue(10, 12, 'hello there')],
        transcribeWithWhisper
      })
    );

    expect(transcribeWithWhisper).toHaveBeenCalledWith('C:\\Movies\\movie.mp4', 'tiny');
  });

  it('skips remote fetching cleanly when capabilities disable it', async () => {
    const fetchRemoteSubtitleCues = vi.fn(async () => [createCue(20, 21, 'fuck')]);

    await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie',
        options: {
          enhancedMode: false,
          allowRemoteSubtitles: true
        }
      },
      createDependencies({
        fetchRemoteSubtitleCues,
        getCapabilities: () => ({
          remoteSubtitlesAvailable: false,
          whisperBaseAvailable: true,
          whisperTinyAvailable: true
        })
      })
    );

    expect(fetchRemoteSubtitleCues).not.toHaveBeenCalled();
  });

  it('throws a clear setup error when whisper base fallback is required but unavailable', async () => {
    await expect(
      analyzeProfanity(
        {
          inputPath: 'C:\\Movies\\movie.mp4',
          movieTitle: 'movie',
          options: {
            enhancedMode: false,
            allowRemoteSubtitles: false
          }
        },
        createDependencies({
          getCapabilities: () => ({
            remoteSubtitlesAvailable: false,
            whisperBaseAvailable: false,
            whisperTinyAvailable: false
          })
        })
      )
    ).rejects.toThrow(
      'No usable embedded or remote subtitles were found, and whisper.cpp base fallback is not configured.'
    );
  });

  it('skips enhanced refinement when whisper tiny is unavailable', async () => {
    const transcribeWithWhisper = vi.fn(async () => [createCue(25, 26, 'bitch')]);

    const result = await analyzeProfanity(
      {
        inputPath: 'C:\\Movies\\movie.mp4',
        movieTitle: 'movie',
        options: {
          enhancedMode: true,
          allowRemoteSubtitles: false
        }
      },
      createDependencies({
        probeSubtitleStreams: async () => ({
          duration: 120,
          streams: [{ index: 2, codec_type: 'subtitle', codec_name: 'subrip' }]
        }),
        extractEmbeddedSubtitleCues: async () => [createCue(10, 11, 'mild line')],
        transcribeWithWhisper,
        getCapabilities: () => ({
          remoteSubtitlesAvailable: true,
          whisperBaseAvailable: true,
          whisperTinyAvailable: false
        })
      })
    );

    expect(transcribeWithWhisper).not.toHaveBeenCalled();
    expect(result.whisperRefinementApplied).toBe(false);
    expect(result.usedSources).toEqual(['embedded']);
  });
});
