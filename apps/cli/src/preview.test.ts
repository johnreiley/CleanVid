import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeMedia, runCommand, type CommandResult } from './ffmpeg.js';
import {
  buildPreviewCacheKey,
  buildPreviewEncodeArgs,
  buildPreviewEncodePlans,
  detectAvailablePreviewEncoders,
  encodePreview,
  encodePreviewWithPlans,
  preparePreviewPlayback,
  remuxPreview,
  resetPreviewEncoderAvailabilityCache,
  type PreviewEncodePlan
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
  resetPreviewEncoderAvailabilityCache();

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
  it('changes when the source size, modified time, or output profile changes', () => {
    const first = buildPreviewCacheKey(
      'C:\\Movies\\movie.mkv',
      {
        size: 100,
        mtimeMs: 1_000
      },
      'normal'
    );
    const second = buildPreviewCacheKey(
      'C:\\Movies\\movie.mkv',
      {
        size: 200,
        mtimeMs: 1_000
      },
      'normal'
    );
    const third = buildPreviewCacheKey(
      'C:\\Movies\\movie.mkv',
      {
        size: 100,
        mtimeMs: 2_000
      },
      'normal'
    );
    const fourth = buildPreviewCacheKey(
      'C:\\Movies\\movie.mkv',
      {
        size: 100,
        mtimeMs: 1_000
      },
      'weak-480p'
    );

    expect(first).not.toBe(second);
    expect(first).not.toBe(third);
    expect(first).not.toBe(fourth);
  });
});

describe('preview encoder detection', () => {
  it('probes hardware encoders with the expected sample size and records availability', async () => {
    const runCommandImpl = vi.fn(
      async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args.includes('h264_nvenc') || args.includes('h264_qsv')) {
          return { stdout: '', stderr: '' };
        }

        throw new Error('encoder unavailable');
      }
    );

    await expect(detectAvailablePreviewEncoders(runCommandImpl)).resolves.toEqual({
      h264_nvenc: true,
      h264_amf: false,
      h264_qsv: true
    });

    const nvencArgs = runCommandImpl.mock.calls.find(([, args]) => args.includes('h264_nvenc'))?.[1];
    expect(nvencArgs).toContain('color=c=black:s=128x72:r=1');
  });
});

describe('preview encode plans', () => {
  it('prefers dedicated GPU encoders ahead of qsv and software on stronger machines', () => {
    expect(
      buildPreviewEncodePlans(
        {
          h264_nvenc: true,
          h264_amf: false,
          h264_qsv: true
        },
        8
      )
    ).toEqual([
      { encoder: 'h264_nvenc', weakMachine: false, profile: 'normal' },
      { encoder: 'h264_qsv', weakMachine: false, profile: 'normal' },
      { encoder: 'libx264', weakMachine: false, profile: 'normal' }
    ]);
  });

  it('switches to the weak profile when no hardware encoder is usable', () => {
    expect(
      buildPreviewEncodePlans(
        {
          h264_nvenc: false,
          h264_amf: false,
          h264_qsv: false
        },
        8
      )
    ).toEqual([{ encoder: 'libx264', weakMachine: true, profile: 'weak-480p' }]);
  });

  it('switches to the weak profile on low-core machines even with hardware encoding available', () => {
    expect(
      buildPreviewEncodePlans(
        {
          h264_nvenc: false,
          h264_amf: false,
          h264_qsv: true
        },
        4
      )
    ).toEqual([
      { encoder: 'h264_qsv', weakMachine: true, profile: 'weak-480p' },
      { encoder: 'libx264', weakMachine: true, profile: 'weak-480p' }
    ]);
  });
});

describe('preview encode args', () => {
  it('uses the weak-machine filter and lighter audio settings when the plan is weak', () => {
    const args = buildPreviewEncodeArgs('input.mkv', 'output.mp4', {
      encoder: 'libx264',
      weakMachine: true,
      profile: 'weak-480p'
    });

    expect(args).toContain('-vf');
    expect(args).toContain('scale=854:480:force_original_aspect_ratio=decrease:flags=fast_bilinear');
    expect(args).toContain('ultrafast');
    expect(args).toContain('96k');
  });
});

describe('preview encoding fallback', () => {
  it('falls through to the next encoder plan when an earlier attempt fails', async () => {
    const plans: PreviewEncodePlan[] = [
      { encoder: 'h264_nvenc', weakMachine: false, profile: 'normal' },
      { encoder: 'libx264', weakMachine: false, profile: 'normal' }
    ];
    const runCommandImpl = vi.fn(
      async (_command: string, args: string[]): Promise<CommandResult> => {
        if (args.includes('h264_nvenc')) {
          throw new Error('nvenc failed');
        }

        return { stdout: '', stderr: '' };
      }
    );

    await expect(
      encodePreviewWithPlans('C:\\Movies\\movie.mkv', 'C:\\Temp\\preview.mp4', plans, runCommandImpl)
    ).resolves.toBeUndefined();

    expect(runCommandImpl).toHaveBeenCalledTimes(2);
    expect(runCommandImpl.mock.calls[0]?.[1]).toContain('h264_nvenc');
    expect(runCommandImpl.mock.calls[1]?.[1]).toContain('libx264');
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
        getLogicalCpuCount: () => 8,
        probeStreams,
        pathExists: async () => true,
        pruneCacheDirectory: async () => undefined,
        resolveEncodePlans: async () => [
          { encoder: 'h264_nvenc', weakMachine: false, profile: 'normal' },
          { encoder: 'libx264', weakMachine: false, profile: 'normal' }
        ],
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
    const encodePlans: PreviewEncodePlan[] = [
      { encoder: 'h264_nvenc', weakMachine: false, profile: 'normal' },
      { encoder: 'libx264', weakMachine: false, profile: 'normal' }
    ];
    const encodePreviewImpl = vi.fn(async () => undefined);

    await preparePreviewPlayback('C:\\Movies\\movie.mkv', {
      ensureCacheDirectory: async () => 'C:\\Cache',
      getInputStats: async () => ({ size: 100, mtimeMs: 2_000 }),
      getLogicalCpuCount: () => 8,
      probeStreams: async () => ({
        streams: [{ codec_type: 'video', codec_name: 'h264' }, { codec_type: 'audio', codec_name: 'aac' }]
      }),
      pathExists: async () => false,
      pruneCacheDirectory: async () => undefined,
      resolveEncodePlans: async () => encodePlans,
      remuxPreview: async () => {
        throw new Error('copy failed');
      },
      encodePreview: encodePreviewImpl,
      moveFile: async () => undefined,
      removeFile: async () => undefined
    });

    expect(encodePreviewImpl).toHaveBeenCalledTimes(1);
    expect(encodePreviewImpl).toHaveBeenCalledWith(
      'C:\\Movies\\movie.mkv',
      expect.stringContaining('.tmp.mp4'),
      encodePlans
    );
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

  it('creates a playable mp4 through the software encode path', async () => {
    const directory = await createTempDir();
    const inputPath = path.join(directory, 'input.mkv');
    const outputPath = path.join(directory, 'output-encode.mp4');

    await createFixtureMkv(inputPath);
    await encodePreview(inputPath, outputPath, [
      { encoder: 'libx264', weakMachine: false, profile: 'normal' }
    ]);

    const mediaInfo = await probeMedia(outputPath);
    const outputContents = await readFile(outputPath);

    expect(outputContents.byteLength).toBeGreaterThan(0);
    expect(mediaInfo.duration).toBeGreaterThan(3.7);
    expect(mediaInfo.duration).toBeLessThan(4.2);
  });
});
