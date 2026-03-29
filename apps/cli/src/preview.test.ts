import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeMedia, runCommand } from './ffmpeg.js';
import {
  buildPreviewCacheKey,
  encodePreview,
  preparePreviewPlayback,
  remuxPreview
} from './preview.js';

const tempDirectories: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cleanvid-preview-'));
  tempDirectories.push(directory);
  return directory;
}

async function createFixtureMkv(outputPath: string): Promise<void> {
  await runCommand('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x90:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000',
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    outputPath
  ]);
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

describe('preview cache keys', () => {
  it('changes when the source size or modified time changes', () => {
    const first = buildPreviewCacheKey('C:\\Movies\\movie.mkv', {
      size: 100,
      mtimeMs: 1_000
    });
    const second = buildPreviewCacheKey('C:\\Movies\\movie.mkv', {
      size: 200,
      mtimeMs: 1_000
    });
    const third = buildPreviewCacheKey('C:\\Movies\\movie.mkv', {
      size: 100,
      mtimeMs: 2_000
    });

    expect(first).not.toBe(second);
    expect(first).not.toBe(third);
  });
});

describe('preview preparation', () => {
  it('reuses cached previews when present', async () => {
    const probeStreams = vi.fn(async () => ({
      streams: [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }]
    }));
    const remuxPreviewImpl = vi.fn(async () => undefined);
    const encodePreviewImpl = vi.fn(async () => undefined);

    await expect(
      preparePreviewPlayback('C:\\Movies\\movie.mkv', {
        ensureCacheDirectory: async () => 'C:\\Cache',
        getInputStats: async () => ({ size: 100, mtimeMs: 2_000 }),
        probeStreams,
        pathExists: async () => true,
        pruneCacheDirectory: async () => undefined,
        remuxPreview: remuxPreviewImpl,
        encodePreview: encodePreviewImpl,
        moveFile: async () => undefined,
        removeFile: async () => undefined
      })
    ).resolves.toMatchObject({
      inputPath: 'C:\\Movies\\movie.mkv',
      playbackSource: 'preview'
    });

    expect(probeStreams).not.toHaveBeenCalled();
    expect(remuxPreviewImpl).not.toHaveBeenCalled();
    expect(encodePreviewImpl).not.toHaveBeenCalled();
  });

  it('falls back to preview encoding when remuxing fails', async () => {
    const encodePreviewImpl = vi.fn(async () => undefined);

    await preparePreviewPlayback('C:\\Movies\\movie.mkv', {
      ensureCacheDirectory: async () => 'C:\\Cache',
      getInputStats: async () => ({ size: 100, mtimeMs: 2_000 }),
      probeStreams: async () => ({
        streams: [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }]
      }),
      pathExists: async () => false,
      pruneCacheDirectory: async () => undefined,
      remuxPreview: async () => {
        throw new Error('copy failed');
      },
      encodePreview: encodePreviewImpl,
      moveFile: async () => undefined,
      removeFile: async () => undefined
    });

    expect(encodePreviewImpl).toHaveBeenCalledTimes(1);
  });
});

describe('preview ffmpeg integration', () => {
  it('creates a playable mp4 through the remux path', async () => {
    const directory = await createTempDir();
    const inputPath = path.join(directory, 'input.mkv');
    const outputPath = path.join(directory, 'output-remux.mp4');

    await createFixtureMkv(inputPath);
    await remuxPreview(inputPath, outputPath);

    const mediaInfo = await probeMedia(outputPath);
    const outputContents = await readFile(outputPath);

    expect(outputContents.byteLength).toBeGreaterThan(0);
    expect(mediaInfo.duration).toBeGreaterThan(3.7);
    expect(mediaInfo.duration).toBeLessThan(4.2);
  });

  it('creates a playable mp4 through the encode path', async () => {
    const directory = await createTempDir();
    const inputPath = path.join(directory, 'input.mkv');
    const outputPath = path.join(directory, 'output-encode.mp4');

    await createFixtureMkv(inputPath);
    await encodePreview(inputPath, outputPath);

    const mediaInfo = await probeMedia(outputPath);
    const outputContents = await readFile(outputPath);

    expect(outputContents.byteLength).toBeGreaterThan(0);
    expect(mediaInfo.duration).toBeGreaterThan(3.7);
    expect(mediaInfo.duration).toBeLessThan(4.2);
  });
});
