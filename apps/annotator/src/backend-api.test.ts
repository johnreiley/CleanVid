import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProfanityAnalysisResult } from '@cleanvid/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPlaybackRegistry,
  deriveDefaultOutputPath,
  deriveExportedFiltersPath,
  handleAnalyzeProfanityRequest,
  handleMediaRequest,
  handleOpenVideoRequest,
  handleSelectSubtitlePathRequest,
  handleSelectOutputPathRequest,
  handleProcessRequest
} from '../vite.config';

const tempDirectories: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cleanvid-annotator-api-'));
  tempDirectories.push(directory);
  return directory;
}

async function withMediaServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>
) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();

  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to determine test server address.');
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true
      })
    )
  );
});

describe('annotator vite api helpers', () => {
  it('returns the expected open-video shapes for original playback and cancellation', async () => {
    const registerPlaybackPath = vi.fn(() => '/api/media/token-1');
    const progressEvents: unknown[] = [];

    await expect(
      handleOpenVideoRequest({
        selectFilePath: async () => path.resolve('Movies', 'movie.mp4'),
        preparePlaybackFile: async (_inputPath, onProgress) => {
          onProgress?.({
            phase: 'check-format',
            message: 'Checking video format...',
            percent: 15
          });

          return {
            inputPath: path.resolve('Movies', 'movie.mp4'),
            playbackPath: path.resolve('Movies', 'movie.mp4'),
            playbackSource: 'original',
            name: 'movie.mp4'
          };
        },
        registerPlaybackPath
      }, (event) => {
        progressEvents.push(event);
      })
    ).resolves.toEqual({
      cancelled: false,
      inputPath: path.resolve('Movies', 'movie.mp4'),
      name: 'movie.mp4',
      outputPath: path.resolve('Movies', 'movie.cleaned.mp4'),
      playbackUrl: '/api/media/token-1',
      playbackSource: 'original'
    });

    expect(registerPlaybackPath).toHaveBeenCalledWith(path.resolve('Movies', 'movie.mp4'));
    expect(progressEvents).toEqual([
      {
        phase: 'select-file',
        message: 'Waiting for video selection...',
        percent: 5
      },
      {
        phase: 'check-format',
        message: 'Checking video format...',
        percent: 15
      }
    ]);

    await expect(
      handleOpenVideoRequest({
        selectFilePath: async () => null,
        preparePlaybackFile: async () => {
          throw new Error('should not run');
        },
        registerPlaybackPath: () => '/api/media/token-2'
      })
    ).resolves.toEqual({ cancelled: true });
  });

  it('returns preview playback metadata when preprocessing is needed', async () => {
    await expect(
      handleOpenVideoRequest({
        selectFilePath: async () => path.resolve('Movies', 'movie.mkv'),
        preparePlaybackFile: async () => ({
          inputPath: path.resolve('Movies', 'movie.mkv'),
          playbackPath: path.resolve('Temp', 'preview.mp4'),
          playbackSource: 'preview',
          name: 'movie.mkv'
        }),
        registerPlaybackPath: () => '/api/media/token-preview'
      })
    ).resolves.toEqual({
      cancelled: false,
      inputPath: path.resolve('Movies', 'movie.mkv'),
      name: 'movie.mkv',
      outputPath: path.resolve('Movies', 'movie.cleaned.mkv'),
      playbackUrl: '/api/media/token-preview',
      playbackSource: 'preview'
    });
  });

  it('returns the selected output path shape and supports cancellation', async () => {
    await expect(
      handleSelectOutputPathRequest(
        {
          outputPath: path.resolve('Exports', 'movie.cleaned.mp4')
        },
        {
          selectOutputPath: async (suggestedPath) => {
            expect(suggestedPath).toBe(path.resolve('Exports', 'movie.cleaned.mp4'));
            return path.resolve('Exports', 'custom-output.mp4');
          }
        }
      )
    ).resolves.toEqual({
      cancelled: false,
      outputPath: path.resolve('Exports', 'custom-output.mp4')
    });

    await expect(
      handleSelectOutputPathRequest(
        {
          outputPath: path.resolve('Exports', 'movie.cleaned.mp4')
        },
        {
          selectOutputPath: async () => null
        }
      )
    ).resolves.toEqual({ cancelled: true });
  });

  it('returns the selected subtitle path shape and supports cancellation', async () => {
    await expect(
      handleSelectSubtitlePathRequest({
        selectSubtitlePath: async () => path.resolve('Subtitles', 'movie.srt')
      })
    ).resolves.toEqual({
      cancelled: false,
      subtitlePath: path.resolve('Subtitles', 'movie.srt')
    });

    await expect(
      handleSelectSubtitlePathRequest({
        selectSubtitlePath: async () => null
      })
    ).resolves.toEqual({ cancelled: true });
  });

  it('validates the profanity analysis request and forwards progress events', async () => {
    const analyzeProfanityImpl = vi.fn(async ({ onProgress, subtitlePath }): Promise<ProfanityAnalysisResult> => {
      onProgress?.({
        phase: 'detect-profanity',
        message: 'Detecting profanity...',
        percent: 88
      });

      return {
        suggestions: [
          {
            id: 'suggestion-1',
            start: 10,
            end: 11,
            snippet: 'oh shit',
            source: 'provided',
            matchedTerms: ['shit'],
            sources: ['provided']
          }
        ],
        usedSources: [subtitlePath ? 'provided' : 'embedded'],
        subtitleCueCount: 1,
        message: 'Detected 1 draft mute suggestion.'
      };
    });
    const progressEvents: unknown[] = [];

    await expect(
      handleAnalyzeProfanityRequest(
        {
          inputPath: path.resolve('Movies', 'movie.mp4'),
          movieTitle: 'movie',
          subtitlePath: path.resolve('Subtitles', 'movie.srt')
        },
        {
          ensureInputExists: async () => undefined,
          analyzeProfanityImpl
        },
        (event) => {
          progressEvents.push(event);
        }
      )
    ).resolves.toEqual({
      suggestions: [
        {
          id: 'suggestion-1',
          start: 10,
          end: 11,
          snippet: 'oh shit',
          source: 'provided',
          matchedTerms: ['shit'],
          sources: ['provided']
        }
      ],
      usedSources: ['provided'],
      subtitleCueCount: 1,
      message: 'Detected 1 draft mute suggestion.'
    });

    expect(analyzeProfanityImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: path.resolve('Movies', 'movie.mp4'),
        movieTitle: 'movie',
        subtitlePath: path.resolve('Subtitles', 'movie.srt')
      })
    );
    expect(progressEvents).toEqual([
      {
        phase: 'detect-profanity',
        message: 'Detecting profanity...',
        percent: 88
      }
    ]);
  });

  it('validates the independent analysis inputs and skips an inactive subtitle path', async () => {
    const ensureInputExists = vi.fn(async () => undefined);
    const analyzeProfanityImpl = vi.fn(async (): Promise<ProfanityAnalysisResult> => ({
      suggestions: [], usedSources: ['transcript'], subtitleCueCount: 0, message: 'Done'
    }));
    const dependencies = { ensureInputExists, analyzeProfanityImpl };
    const options = {
      inputPath: path.resolve('Movies', 'movie.mp4'),
      subtitlePath: path.resolve('Subtitles', 'old.srt'),
      subtitleMode: 'none',
      transcriptPath: path.resolve('Transcripts', 'movie.json'),
      subtitleOffset: -1.25,
      estimateMissingWords: false,
      wordPadding: { before: 0, after: 0.15 }
    };
    await handleAnalyzeProfanityRequest(options, dependencies);
    expect(ensureInputExists.mock.calls).toEqual([[options.inputPath], [options.transcriptPath]]);
    expect(analyzeProfanityImpl).toHaveBeenCalledWith(expect.objectContaining(options));

    for (const [field, value] of [
      ['transcriptPath', 1], ['subtitleMode', 'guess'], ['subtitleStreamIndex', -1],
      ['subtitleOffset', '0'], ['estimateMissingWords', 'false'], ['wordPadding', { before: -0.1, after: 0 }]
    ]) {
      await expect(handleAnalyzeProfanityRequest({ ...options, [field as string]: value }, dependencies)).rejects.toThrow(String(field));
    }
  });

  it('derives the default cleaned output path beside the input file', () => {
    expect(deriveDefaultOutputPath(path.resolve('Movies', 'movie.mp4'))).toBe(path.resolve('Movies', 'movie.cleaned.mp4'));
    expect(deriveDefaultOutputPath(path.resolve('Movies', 'movie'))).toBe(path.resolve('Movies', 'movie.cleaned'));
  });

  it('rejects missing input paths and invalid filter payloads', async () => {
    await expect(
      handleProcessRequest(
        {
          inputPath: '',
          filters: []
        },
        {
          ensureInputExists: async () => undefined,
          createTempFilterFile: async () => ({
            filtersPath: 'filters.json',
            cleanup: async () => undefined
          }),
          processMediaImpl: async () => undefined,
          writeExportedFilterFile: async () => 'filters-output.json'
        }
      )
    ).rejects.toThrow('inputPath is required.');

    await expect(
      handleProcessRequest(
        {
          inputPath: path.resolve('Movies', 'movie.mp4'),
          filters: [{ id: '', type: 'skip', start: 1, end: 2 }]
        },
        {
          ensureInputExists: async () => undefined,
          createTempFilterFile: async () => ({
            filtersPath: 'filters.json',
            cleanup: async () => undefined
          }),
          processMediaImpl: async () => undefined,
          writeExportedFilterFile: async () => 'filters-output.json'
        }
      )
    ).rejects.toThrow('filters[0].id must be a non-empty string.');
  });

  it('creates a temp filter file, derives output paths, exports sibling filter json, and always cleans up', async () => {
    const cleanup = vi.fn(async () => undefined);
    const ensureInputExists = vi.fn(async () => undefined);
    const createTempFilterFile = vi.fn(async (content: string) => {
      expect(content).toContain('"type": "skip"');
      return {
        filtersPath: path.resolve('Temp', 'filters.json'),
        cleanup
      };
    });
    const processMediaImpl = vi.fn(async () => undefined);
    const writeExportedFilterFile = vi.fn(async () => path.resolve('Movies', 'movie.cleaned.filters.json'));

    await expect(
      handleProcessRequest(
        {
          inputPath: path.resolve('Movies', 'movie.mkv'),
          filters: [{ id: 'seg-1', type: 'skip', start: 10, end: 20 }]
        },
        {
          ensureInputExists,
          createTempFilterFile,
          processMediaImpl,
          writeExportedFilterFile
        }
      )
    ).resolves.toEqual({
      outputPath: path.resolve('Movies', 'movie.cleaned.mkv'),
      filtersPath: path.resolve('Movies', 'movie.cleaned.filters.json'),
      message: `Processed video to ${path.resolve('Movies', 'movie.cleaned.mkv')}.`
    });

    expect(ensureInputExists).toHaveBeenCalledWith(path.resolve('Movies', 'movie.mkv'));
    expect(processMediaImpl).toHaveBeenCalledWith({
      inputPath: path.resolve('Movies', 'movie.mkv'),
      filtersPath: path.resolve('Temp', 'filters.json'),
      outputPath: path.resolve('Movies', 'movie.cleaned.mkv')
    });
    expect(writeExportedFilterFile).toHaveBeenCalledWith(
      path.resolve('Movies', 'movie.cleaned.mkv'),
      expect.stringContaining('"type": "skip"')
    );
    expect(cleanup).toHaveBeenCalledTimes(1);

    cleanup.mockClear();
    writeExportedFilterFile.mockClear();

    await expect(
      handleProcessRequest(
        {
          inputPath: path.resolve('Movies', 'movie.mkv'),
          filters: [{ id: 'seg-1', type: 'skip', start: 10, end: 20 }]
        },
        {
          ensureInputExists,
          createTempFilterFile,
          writeExportedFilterFile,
          processMediaImpl: async () => {
            throw new Error('boom');
          }
        }
      )
    ).rejects.toThrow('boom');

    expect(writeExportedFilterFile).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('derives the exported filters path beside the processed video', () => {
    expect(deriveExportedFiltersPath(path.resolve('Movies', 'movie.cleaned.mp4'))).toBe(
      path.resolve('Movies', 'movie.cleaned.filters.json')
    );
    expect(deriveExportedFiltersPath(path.resolve('Exports', 'movie.cleaned'))).toBe(
      path.resolve('Exports', 'movie.cleaned.filters.json')
    );
  });

  it('serves byte ranges through the media endpoint', async () => {
    const directory = await createTempDir();
    const playbackFile = path.join(directory, 'movie.mp4');
    await writeFile(playbackFile, '0123456789', 'utf8');

    const playbackRegistry = createPlaybackRegistry();
    const playbackUrl = playbackRegistry.registerPlaybackPath(playbackFile);

    await withMediaServer(
      (request, response) => {
        void handleMediaRequest(request, response, playbackRegistry).then((handled) => {
          if (!handled) {
            response.statusCode = 404;
            response.end();
          }
        });
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}${playbackUrl}`, {
          headers: {
            Connection: 'close',
            Range: 'bytes=2-5'
          }
        });

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
        await expect(response.text()).resolves.toBe('2345');
      }
    );
  });
});
