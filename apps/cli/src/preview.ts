import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  access,
  mkdir,
  readdir,
  rename,
  rm,
  stat
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand, type ProbeResponse } from './ffmpeg.js';

const DIRECT_PLAY_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const PREPROCESS_EXTENSION = '.mkv';
const PREVIEW_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const REMUXABLE_VIDEO_CODECS = new Set(['h264']);
const REMUXABLE_AUDIO_CODECS = new Set(['aac', 'mp3']);

export type PlaybackSource = 'original' | 'preview';

export interface PreviewPreparationResult {
  inputPath: string;
  playbackPath: string;
  playbackSource: PlaybackSource;
  name: string;
}

export interface PreviewPreparationDependencies {
  ensureCacheDirectory: () => Promise<string>;
  getInputStats: (inputPath: string) => Promise<Pick<Stats, 'size' | 'mtimeMs'>>;
  probeStreams: (inputPath: string) => Promise<ProbeResponse>;
  pathExists: (candidatePath: string) => Promise<boolean>;
  pruneCacheDirectory: (cacheDirectory: string) => Promise<void>;
  remuxPreview: (inputPath: string, outputPath: string) => Promise<void>;
  encodePreview: (inputPath: string, outputPath: string) => Promise<void>;
  moveFile: (sourcePath: string, targetPath: string) => Promise<void>;
  removeFile: (targetPath: string) => Promise<void>;
}

function createDefaultPreviewPreparationDependencies(): PreviewPreparationDependencies {
  return {
    ensureCacheDirectory: ensurePreviewCacheDirectory,
    getInputStats: async (inputPath) => stat(inputPath),
    probeStreams,
    pathExists: async (candidatePath) => {
      try {
        await access(candidatePath);
        return true;
      } catch {
        return false;
      }
    },
    pruneCacheDirectory: prunePreviewCacheDirectory,
    remuxPreview,
    encodePreview,
    moveFile: rename,
    removeFile: async (targetPath) => {
      await rm(targetPath, { force: true });
    }
  };
}

export function isDirectPlayExtension(extension: string): boolean {
  return DIRECT_PLAY_EXTENSIONS.has(extension.toLowerCase());
}

export function requiresPreviewGeneration(extension: string): boolean {
  return extension.toLowerCase() === PREPROCESS_EXTENSION;
}

export function buildPreviewCacheKey(
  inputPath: string,
  stats: Pick<Stats, 'size' | 'mtimeMs'>
): string {
  return createHash('sha1')
    .update(JSON.stringify([path.resolve(inputPath), stats.size, Math.trunc(stats.mtimeMs)]))
    .digest('hex');
}

export function getPreviewCacheDirectory(): string {
  return path.join(os.tmpdir(), 'cleanvid-preview-cache');
}

export async function ensurePreviewCacheDirectory(): Promise<string> {
  const cacheDirectory = getPreviewCacheDirectory();
  await mkdir(cacheDirectory, { recursive: true });
  return cacheDirectory;
}

export async function prunePreviewCacheDirectory(cacheDirectory: string): Promise<void> {
  const cutoff = Date.now() - PREVIEW_CACHE_RETENTION_MS;
  const entries = await readdir(cacheDirectory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.preview.mp4')) {
        return;
      }

      const entryPath = path.join(cacheDirectory, entry.name);

      try {
        const entryStats = await stat(entryPath);

        if (entryStats.mtimeMs < cutoff) {
          await rm(entryPath, { force: true });
        }
      } catch {
        // Best-effort cache pruning should never block opening a video.
      }
    })
  );
}

export async function probeStreams(inputPath: string): Promise<ProbeResponse> {
  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    inputPath
  ]);

  return JSON.parse(stdout) as ProbeResponse;
}

export function canRemuxToBrowserSafeMp4(probeResponse: ProbeResponse): boolean {
  const streams = probeResponse.streams ?? [];
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');

  if (videoStreams.length === 0) {
    return false;
  }

  const videoCompatible = videoStreams.every((stream) =>
    REMUXABLE_VIDEO_CODECS.has((stream.codec_name ?? '').toLowerCase())
  );
  const audioCompatible = audioStreams.every((stream) =>
    REMUXABLE_AUDIO_CODECS.has((stream.codec_name ?? '').toLowerCase())
  );

  return videoCompatible && audioCompatible;
}

export async function remuxPreview(inputPath: string, outputPath: string): Promise<void> {
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outputPath
  ]);
}

export async function encodePreview(inputPath: string, outputPath: string): Promise<void> {
  await runCommand('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath
  ]);
}

export async function preparePreviewPlayback(
  inputPath: string,
  dependencies: PreviewPreparationDependencies = createDefaultPreviewPreparationDependencies()
): Promise<PreviewPreparationResult> {
  const resolvedInputPath = path.resolve(inputPath);
  const extension = path.extname(resolvedInputPath).toLowerCase();

  if (isDirectPlayExtension(extension)) {
    return {
      inputPath: resolvedInputPath,
      playbackPath: resolvedInputPath,
      playbackSource: 'original',
      name: path.basename(resolvedInputPath)
    };
  }

  if (!requiresPreviewGeneration(extension)) {
    throw new Error(
      'Unsupported video format. Open an .mp4, .m4v, .mov, .webm, or .mkv file.'
    );
  }

  const cacheDirectory = await dependencies.ensureCacheDirectory();
  void dependencies.pruneCacheDirectory(cacheDirectory).catch(() => {
    // Best-effort cache pruning should never block opening a video.
  });

  const inputStats = await dependencies.getInputStats(resolvedInputPath);
  const cacheKey = buildPreviewCacheKey(resolvedInputPath, inputStats);
  const previewPath = path.join(cacheDirectory, `${cacheKey}.preview.mp4`);

  if (await dependencies.pathExists(previewPath)) {
    return {
      inputPath: resolvedInputPath,
      playbackPath: previewPath,
      playbackSource: 'preview',
      name: path.basename(resolvedInputPath)
    };
  }

  const temporaryPreviewPath = path.join(
    cacheDirectory,
    `${cacheKey}.${process.pid}.${Date.now()}.tmp.mp4`
  );

  try {
    const probeResponse = await dependencies.probeStreams(resolvedInputPath);

    if (canRemuxToBrowserSafeMp4(probeResponse)) {
      try {
        await dependencies.remuxPreview(resolvedInputPath, temporaryPreviewPath);
      } catch {
        await dependencies.encodePreview(resolvedInputPath, temporaryPreviewPath);
      }
    } else {
      await dependencies.encodePreview(resolvedInputPath, temporaryPreviewPath);
    }

    await dependencies.moveFile(temporaryPreviewPath, previewPath);
  } catch (error) {
    await dependencies.removeFile(temporaryPreviewPath);

    if (error instanceof Error) {
      throw new Error(`Unable to prepare video preview: ${error.message}`);
    }

    throw error;
  }

  return {
    inputPath: resolvedInputPath,
    playbackPath: previewPath,
    playbackSource: 'preview',
    name: path.basename(resolvedInputPath)
  };
}
