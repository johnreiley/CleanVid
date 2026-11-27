import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { TimedTextCue } from '@cleanvid/shared';
import { runCommand } from '../../cli/src/ffmpeg.js';
import { remuxPreview } from '../../cli/src/preview.js';
import { processMedia } from '../../cli/src/processor.js';
import { parseMtsTranscript, type MtsTranscript } from './mts-transcript.js';
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
    readTranscriptFile: async () => '',
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
      'No usable subtitles were found. Choose a subtitle file (.srt, .vtt, .ass, .ssa) or a Media Transcription Studio transcript (.json)'
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
    expect(result.suggestions[0]).toMatchObject({ start: 9.85, end: 12.25, matchedTerms: ['damn', 'shit'] });
  });
});

const uuid = '1a22bc44-2aa0-4455-9a96-a12511228793';

function transcriptFixture(overrides: Partial<MtsTranscript> = {}): MtsTranscript {
  return {
    schemaVersion: 1,
    mediaId: uuid,
    mediaVersionId: uuid,
    jobId: uuid,
    source: {
      fileName: 'movie.mp4', sizeBytes: 12345, durationMs: 20000,
      playbackOrigin: 'normalized-container-presentation-time', audioStreamIndex: 3, language: 'en', channels: 2
    },
    engine: {
      name: 'faster-whisper', version: '1.0.0', model: 'test', modelRevision: 'test',
      profileHash: 'f'.repeat(64), computeType: 'int8', wordTimestampMethod: 'engine-native'
    },
    coverage: { expectedChunks: 2, completedChunks: 2, audioDurationMs: 20000, warnings: [] },
    segments: [],
    ...overrides
  };
}

function word(id: string, startMs: number, endMs: number, text: string): MtsTranscript['segments'][number]['words'][number] {
  return { id, startMs, endMs, text, probability: null };
}

const jsonRequest = { inputPath: 'C:\\Movies\\movie.mp4', subtitlePath: 'C:\\Transcripts\\movie.JSON' };

function jsonDependencies(transcript: MtsTranscript): AnalyzeProfanityDependencies {
  return createDependencies({
    probeSubtitleStreams: async () => ({
      duration: 20,
      sizeBytes: 12345,
      streams: [{ index: 0, codec_type: 'video' }, { index: 3, codec_type: 'audio' }, { index: 4, codec_type: 'audio' }]
    }),
    readTranscriptFile: vi.fn(async () => JSON.stringify(transcript)),
    loadProvidedSubtitleCues: vi.fn(async () => null),
    extractEmbeddedSubtitleCues: vi.fn(async () => null)
  });
}

describe('MTS transcript analysis', () => {
  it('detects exact word and phrase spans, merges touching ranges and leaves a 1 ms gap intact', async () => {
    const transcript = transcriptFixture({ segments: [{
      id: 'segment', startMs: 12000, endMs: 15000, text: 'Uh, SHIT! [damn] Oh, my God! Damn.',
      words: [
        word('1', 12200, 12300, 'Uh,'), word('2', 12400, 12700, ' SHIT!'),
        word('3', 12700, 12701, ' [damn]'), word('4', 12701, 12800, ' Oh,'),
        word('5', 12800, 12900, 'my'), word('6', 12900, 13000, ' God!'),
        word('7', 13000, 13100, ' Damn.')
      ]
    }] });
    const dependencies = jsonDependencies(transcript);
    const onProgress = vi.fn();
    const result = await analyzeProfanity({ ...jsonRequest, onProgress }, dependencies);

    expect(result.suggestions).toEqual([
      expect.objectContaining({ start: 12.4, end: 12.7, source: 'transcript', matchedTerms: ['shit'] }),
      expect.objectContaining({ start: 12.701, end: 13.1, source: 'transcript', snippet: 'Oh, my God! Damn.', matchedTerms: ['damn', 'god', 'oh my god'] })
    ]);
    expect(result).toMatchObject({ usedSources: ['transcript'], transcriptSegmentCount: 1, warnings: [] });
    expect(dependencies.readTranscriptFile).toHaveBeenCalledWith(jsonRequest.subtitlePath);
    expect(dependencies.loadProvidedSubtitleCues).not.toHaveBeenCalled();
    expect(dependencies.extractEmbeddedSubtitleCues).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'load-provided-transcript', percent: 38 }));
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'done', percent: 100 }));
  });

  it('uses exact segment fallback ranges but never widens a zero-duration match', async () => {
    const transcript = transcriptFixture({ segments: [
      { id: 'point', startMs: 1000, endMs: 2000, text: 'Damn!', words: [word('1', 1250, 1250, ' Damn!')] },
      { id: 'missing', startMs: 2000, endMs: 3000, text: 'Shit.', words: [] },
      { id: 'partial', startMs: 4000, endMs: 5000, text: 'Shit, shit.', words: [word('2', 4200, 4400, 'Shit,')] }
    ] });
    const result = await analyzeProfanity(jsonRequest, jsonDependencies(transcript));

    expect(result.suggestions.map(({ start, end }) => [start, end])).toEqual([[2, 3], [4, 5]]);
    expect(result.warnings).toEqual([
      expect.stringContaining('segment timestamps'),
      expect.stringContaining('damn at 1.250s')
    ]);
  });

  it('reports silence, incomplete coverage and source metadata differences without inventing matches', async () => {
    const transcript = transcriptFixture({
      source: { ...transcriptFixture().source, fileName: 'renamed.mp4', sizeBytes: 1 },
      coverage: { expectedChunks: 2, completedChunks: 1, audioDurationMs: 20000, warnings: ['Exporter warning'] }
    });
    const result = await analyzeProfanity(jsonRequest, jsonDependencies(transcript));

    expect(result.message).toBe('No speech was transcribed.');
    expect(result.suggestions).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining('filename or file size'), expect.stringContaining('1 of 2'), 'Exporter warning'
    ]);

    const cleanSpeech = transcriptFixture({ segments: [{ id: 'clean', startMs: 0, endMs: 250, text: 'Hi', words: [] }] });
    await expect(analyzeProfanity(jsonRequest, jsonDependencies(cleanSpeech))).resolves.toMatchObject({
      message: 'No profanity matches were detected in the transcript.', warnings: []
    });
  });

  it('rejects clear duration and audio-track mismatches', async () => {
    for (const [source, error] of [
      [{ durationMs: 15000 }, 'duration does not match'],
      [{ audioStreamIndex: 4 }, 'audio stream does not match']
    ] as const) {
      const transcript = transcriptFixture({ source: { ...transcriptFixture().source, ...source } });
      await expect(analyzeProfanity(jsonRequest, jsonDependencies(transcript))).rejects.toThrow(error);
    }
  });

  it('does not fall back to subtitles for malformed JSON', async () => {
    const dependencies = jsonDependencies(transcriptFixture());
    dependencies.readTranscriptFile = async () => '{';
    await expect(analyzeProfanity(jsonRequest, dependencies)).rejects.toThrow('invalid JSON');
    expect(dependencies.extractEmbeddedSubtitleCues).not.toHaveBeenCalled();
    expect(dependencies.loadProvidedSubtitleCues).not.toHaveBeenCalled();
  });

  it('validates the v1 shape, reports field paths, and handles a UTF-8 BOM', () => {
    const valid = transcriptFixture({ segments: [{ id: 's', startMs: 0, endMs: 50, text: 'Hi', words: [word('w', 0, 50, 'Hi')] }] });
    expect(parseMtsTranscript(`\uFEFF${JSON.stringify(valid)}`)).toEqual(valid);
    expect(() => parseMtsTranscript(JSON.stringify({ ...valid, schemaVersion: 2 }))).toThrow('Unsupported MTS transcript schemaVersion');
    expect(() => parseMtsTranscript(JSON.stringify({ ...valid, jobId: 'x' }))).toThrow('$.jobId');
    expect(() => parseMtsTranscript(JSON.stringify({ ...valid, source: { ...valid.source, extra: true } }))).toThrow('$.source.extra');
    expect(() => parseMtsTranscript(JSON.stringify({ ...valid, coverage: undefined }))).toThrow('$.coverage');
    valid.segments[0].words[0].probability = 2;
    expect(() => parseMtsTranscript(JSON.stringify(valid))).toThrow('$.segments[0].words[0].probability');
    valid.segments[0].words[0] = word('w', 10, 5, 'Hi');
    expect(() => parseMtsTranscript(JSON.stringify(valid))).toThrow('$.segments[0].words[0].endMs');
  });

  it('keeps normalized transcript times aligned with preview and export for offset multitrack media', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'cleanvid-mts-'));
    try {
      const inputPath = path.join(directory, 'movie.mkv');
      const subtitlePath = path.join(directory, 'transcript.json');
      const previewPath = path.join(directory, 'preview.mp4');
      const filtersPath = path.join(directory, 'filters.json');
      const outputPath = path.join(directory, 'cleaned.mp4');

      await runCommand('ffmpeg', [
        '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0', '-t', '3',
        '-c:v', 'libx264', '-c:a', 'aac', '-output_ts_offset', '3', inputPath
      ]);
      async function probeFormat(file: string) {
        const { stdout } = await runCommand('ffprobe', ['-v', 'error', '-of', 'json', '-show_format', file]);
        return JSON.parse(stdout).format as { duration: string; size: string; start_time: string };
      }
      const media = await probeFormat(inputPath);
      expect(Number(media.start_time)).toBeGreaterThan(2);

      const duration = Number(media.duration);
      const transcript = transcriptFixture({
        source: {
          ...transcriptFixture().source, fileName: 'movie.mkv', durationMs: Math.round(duration * 1000),
          sizeBytes: Number(media.size), audioStreamIndex: 1, channels: 1
        },
        segments: [{ id: 's', startMs: 1000, endMs: 2000, text: 'Damn!', words: [word('w', 1250, 1750, ' Damn!')] }]
      });
      await writeFile(subtitlePath, JSON.stringify(transcript));
      const result = await analyzeProfanity({ inputPath, subtitlePath });
      expect(result.suggestions).toMatchObject([{ start: 1.25, end: 1.75 }]);

      await remuxPreview(inputPath, previewPath);
      expect(Number((await probeFormat(previewPath)).start_time)).toBeCloseTo(0, 1);
      await writeFile(filtersPath, JSON.stringify({
        version: 1, movie: { duration },
        filters: result.suggestions.map(({ id, start, end }) => ({ id, type: 'mute', start, end }))
      }));
      await processMedia({ inputPath, filtersPath, outputPath });
      const { stderr } = await runCommand('ffmpeg', [
        '-hide_banner', '-i', outputPath, '-af', 'silencedetect=noise=-45dB:d=0.2',
        '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'
      ]);
      expect(Number(/silence_start: ([\d.]+)/.exec(stderr)?.[1])).toBeCloseTo(1.25, 1);
      expect(Number(/silence_end: ([\d.]+)/.exec(stderr)?.[1])).toBeCloseTo(1.75, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);
});
