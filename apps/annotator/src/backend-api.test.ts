import { describe, expect, it, vi } from 'vitest';
import {
  deriveDefaultOutputPath,
  handleProcessRequest,
  handleSelectFileRequest
} from '../vite.config';

describe('annotator vite api helpers', () => {
  it('returns the expected select-file shapes', async () => {
    await expect(
      handleSelectFileRequest({
        selectFilePath: async () => 'C:\\Movies\\movie.mp4'
      })
    ).resolves.toEqual({
      cancelled: false,
      path: 'C:\\Movies\\movie.mp4',
      name: 'movie.mp4'
    });

    await expect(
      handleSelectFileRequest({
        selectFilePath: async () => null
      })
    ).resolves.toEqual({ cancelled: true });
  });

  it('derives the default cleaned output path beside the input file', () => {
    expect(deriveDefaultOutputPath('C:\\Movies\\movie.mp4')).toBe('C:\\Movies\\movie.cleaned.mp4');
    expect(deriveDefaultOutputPath('C:\\Movies\\movie')).toBe('C:\\Movies\\movie.cleaned');
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
          processMediaImpl: async () => undefined
        }
      )
    ).rejects.toThrow('inputPath is required.');

    await expect(
      handleProcessRequest(
        {
          inputPath: 'C:\\Movies\\movie.mp4',
          filters: [{ id: '', type: 'skip', start: 1, end: 2 }]
        },
        {
          ensureInputExists: async () => undefined,
          createTempFilterFile: async () => ({
            filtersPath: 'filters.json',
            cleanup: async () => undefined
          }),
          processMediaImpl: async () => undefined
        }
      )
    ).rejects.toThrow('filters[0].id must be a non-empty string.');
  });

  it('creates a temp filter file, derives output paths, and always cleans up', async () => {
    const cleanup = vi.fn(async () => undefined);
    const ensureInputExists = vi.fn(async () => undefined);
    const createTempFilterFile = vi.fn(async (content: string) => {
      expect(content).toContain('"type": "skip"');
      return {
        filtersPath: 'C:\\Temp\\filters.json',
        cleanup
      };
    });
    const processMediaImpl = vi.fn(async () => undefined);

    await expect(
      handleProcessRequest(
        {
          inputPath: 'C:\\Movies\\movie.mp4',
          filters: [{ id: 'seg-1', type: 'skip', start: 10, end: 20 }]
        },
        {
          ensureInputExists,
          createTempFilterFile,
          processMediaImpl
        }
      )
    ).resolves.toEqual({
      outputPath: 'C:\\Movies\\movie.cleaned.mp4',
      message: 'Processed video to C:\\Movies\\movie.cleaned.mp4.'
    });

    expect(ensureInputExists).toHaveBeenCalledWith('C:\\Movies\\movie.mp4');
    expect(processMediaImpl).toHaveBeenCalledWith({
      inputPath: 'C:\\Movies\\movie.mp4',
      filtersPath: 'C:\\Temp\\filters.json',
      outputPath: 'C:\\Movies\\movie.cleaned.mp4'
    });
    expect(cleanup).toHaveBeenCalledTimes(1);

    cleanup.mockClear();

    await expect(
      handleProcessRequest(
        {
          inputPath: 'C:\\Movies\\movie.mp4',
          filters: [{ id: 'seg-1', type: 'skip', start: 10, end: 20 }]
        },
        {
          ensureInputExists,
          createTempFilterFile,
          processMediaImpl: async () => {
            throw new Error('boom');
          }
        }
      )
    ).rejects.toThrow('boom');

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
