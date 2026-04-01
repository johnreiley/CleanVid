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
import {
  runCommand,
  runFfmpegWithProgress,
  type CommandResult,
  type ProbeResponse
} from './ffmpeg.js';

const DIRECT_PLAY_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const PREPROCESS_EXTENSION = '.mkv';
const PREVIEW_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_CACHE_SCHEMA_VERSION = 2;
const PREVIEW_ENCODER_PROBE_SIZE = '128x72';
const PREVIEW_WEAK_SCALE_FILTER =
  'scale=854:480:force_original_aspect_ratio=decrease:flags=fast_bilinear';
const PREVIEW_NORMAL_AUDIO_BITRATE = '128k';
const PREVIEW_WEAK_AUDIO_BITRATE = '96k';
const REMUXABLE_VIDEO_CODECS = new Set(['h264']);
const REMUXABLE_AUDIO_CODECS = new Set(['aac', 'mp3']);

export type PlaybackSource = 'original' | 'preview';
export type PreviewVideoEncoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264';
export type PreviewOutputProfile = 'normal' | 'weak-480p';
export type PreviewPreparationPhase =
  | 'select-file'
  | 'check-format'
  | 'check-cache'
  | 'remux'
  | 'encode'
  | 'finalize';

export interface PreviewPreparationProgressEvent {
  phase: PreviewPreparationPhase;
  message: string;
  percent?: number;
}

export interface PreviewFfmpegProgressOptions {
  mediaDurationSeconds?: number;
  onProgress?: (percent: number) => void;
}

export interface PreviewPreparationResult {
  inputPath: string;
  playbackPath: string;
  playbackSource: PlaybackSource;
  name: string;
}

export interface PreviewEncodePlan {
  encoder: PreviewVideoEncoder;
  weakMachine: boolean;
  profile: PreviewOutputProfile;
}

export interface PreviewEncoderAvailability {
  h264_nvenc: boolean;
  h264_amf: boolean;
  h264_qsv: boolean;
}

export interface PreviewPreparationDependencies {
  ensureCacheDirectory: () => Promise<string>;
  getInputStats: (inputPath: string) => Promise<Pick<Stats, 'size' | 'mtimeMs'>>;
  getLogicalCpuCount: () => number;
  probeStreams: (inputPath: string) => Promise<ProbeResponse>;
  pathExists: (candidatePath: string) => Promise<boolean>;
  pruneCacheDirectory: (cacheDirectory: string) => Promise<void>;
  resolveEncodePlans: (logicalCpuCount: number) => Promise<PreviewEncodePlan[]>;
  remuxPreview: (
    inputPath: string,
    outputPath: string,
    options?: PreviewFfmpegProgressOptions
  ) => Promise<void>;
  encodePreview: (
    inputPath: string,
    outputPath: string,
    plans: PreviewEncodePlan[],
    options?: PreviewFfmpegProgressOptions
  ) => Promise<void>;
  moveFile: (sourcePath: string, targetPath: string) => Promise<void>;
  removeFile: (targetPath: string) => Promise<void>;
}

let previewEncoderAvailabilityPromise: Promise<PreviewEncoderAvailability> | null = null;

function createDefaultPreviewPreparationDependencies(): PreviewPreparationDependencies {
  return {
    ensureCacheDirectory: ensurePreviewCacheDirectory,
    getInputStats: async (inputPath) => stat(inputPath),
    getLogicalCpuCount,
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
    resolveEncodePlans,
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
  stats: Pick<Stats, 'size' | 'mtimeMs'>,
  profile: PreviewOutputProfile = 'normal'
): string {
  return createHash('sha1')
    .update(
      JSON.stringify([
        PREVIEW_CACHE_SCHEMA_VERSION,
        path.resolve(inputPath),
        stats.size,
        Math.trunc(stats.mtimeMs),
        profile
      ])
    )
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
    '-show_format',
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

export function getLogicalCpuCount(): number {
  const availableParallelism = (os as typeof os & {
    availableParallelism?: () => number;
  }).availableParallelism;

  if (typeof availableParallelism === 'function') {
    return Math.max(availableParallelism(), 1);
  }

  return Math.max(os.cpus().length, 1);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(value, 100));
}

function mapProgressToRange(progressPercent: number, startPercent: number, endPercent: number): number {
  const clamped = clampPercent(progressPercent);
  return startPercent + ((endPercent - startPercent) * clamped) / 100;
}

function calculateTaskProgressPercent(outTimeSeconds: number, mediaDurationSeconds?: number): number | null {
  if (
    !Number.isFinite(outTimeSeconds) ||
    outTimeSeconds < 0 ||
    !Number.isFinite(mediaDurationSeconds) ||
    (mediaDurationSeconds ?? 0) <= 0
  ) {
    return null;
  }

  return Math.min((outTimeSeconds / (mediaDurationSeconds ?? 1)) * 100, 100);
}

function emitPreviewPreparationProgress(
  onProgress: ((event: PreviewPreparationProgressEvent) => void) | undefined,
  event: PreviewPreparationProgressEvent
) {
  if (!onProgress) {
    return;
  }

  try {
    onProgress(event);
  } catch {
    // Progress reporting is best-effort and should never break preview preparation.
  }
}

function getPreviewDurationSeconds(probeResponse: ProbeResponse): number | undefined {
  const durationSeconds = Number(probeResponse.format?.duration);
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined;
}

function buildPreviewEncoderProbeArgs(encoder: Exclude<PreviewVideoEncoder, 'libx264'>): string[] {
  const baseArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${PREVIEW_ENCODER_PROBE_SIZE}:r=1`,
    '-frames:v',
    '1',
    '-an'
  ];

  switch (encoder) {
    case 'h264_nvenc':
      return [
        ...baseArgs,
        '-c:v',
        'h264_nvenc',
        '-preset',
        'p1',
        '-rc',
        'vbr',
        '-cq',
        '31',
        '-b:v',
        '0',
        '-pix_fmt',
        'yuv420p',
        '-f',
        'null',
        '-'
      ];
    case 'h264_amf':
      return [
        ...baseArgs,
        '-c:v',
        'h264_amf',
        '-usage',
        'transcoding',
        '-quality',
        'speed',
        '-rc',
        'qvbr',
        '-qvbr_quality_level',
        '30',
        '-pix_fmt',
        'nv12',
        '-f',
        'null',
        '-'
      ];
    case 'h264_qsv':
      return [
        ...baseArgs,
        '-c:v',
        'h264_qsv',
        '-preset',
        'veryfast',
        '-global_quality',
        '28',
        '-look_ahead',
        '0',
        '-pix_fmt',
        'nv12',
        '-f',
        'null',
        '-'
      ];
  }
}

async function canUsePreviewEncoder(
  encoder: Exclude<PreviewVideoEncoder, 'libx264'>,
  runCommandImpl: (command: string, args: string[]) => Promise<CommandResult>
): Promise<boolean> {
  try {
    await runCommandImpl('ffmpeg', buildPreviewEncoderProbeArgs(encoder));
    return true;
  } catch {
    return false;
  }
}

export async function detectAvailablePreviewEncoders(
  runCommandImpl: (command: string, args: string[]) => Promise<CommandResult> = runCommand
): Promise<PreviewEncoderAvailability> {
  const [h264_nvenc, h264_amf, h264_qsv] = await Promise.all([
    canUsePreviewEncoder('h264_nvenc', runCommandImpl),
    canUsePreviewEncoder('h264_amf', runCommandImpl),
    canUsePreviewEncoder('h264_qsv', runCommandImpl)
  ]);

  return {
    h264_nvenc,
    h264_amf,
    h264_qsv
  };
}

export function resetPreviewEncoderAvailabilityCache() {
  previewEncoderAvailabilityPromise = null;
}

async function getPreviewEncoderAvailability(): Promise<PreviewEncoderAvailability> {
  if (!previewEncoderAvailabilityPromise) {
    previewEncoderAvailabilityPromise = detectAvailablePreviewEncoders();
  }

  return previewEncoderAvailabilityPromise;
}

export function buildPreviewEncodePlans(
  availability: PreviewEncoderAvailability,
  logicalCpuCount: number
): PreviewEncodePlan[] {
  const hardwareEncoders: PreviewVideoEncoder[] = [];

  if (availability.h264_nvenc) {
    hardwareEncoders.push('h264_nvenc');
  }

  if (availability.h264_amf) {
    hardwareEncoders.push('h264_amf');
  }

  if (availability.h264_qsv) {
    hardwareEncoders.push('h264_qsv');
  }

  const weakMachine = logicalCpuCount <= 4 || hardwareEncoders.length === 0;
  const profile: PreviewOutputProfile = weakMachine ? 'weak-480p' : 'normal';
  const encoderOrder: PreviewVideoEncoder[] = [...hardwareEncoders, 'libx264'];

  return encoderOrder.map((encoder): PreviewEncodePlan => ({
    encoder,
    weakMachine,
    profile
  }));
}

export async function resolveEncodePlans(logicalCpuCount = getLogicalCpuCount()): Promise<PreviewEncodePlan[]> {
  const availability = await getPreviewEncoderAvailability();
  return buildPreviewEncodePlans(availability, logicalCpuCount);
}

function buildPreviewVideoArgs(plan: PreviewEncodePlan): string[] {
  switch (plan.encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'vbr', '-cq', '31', '-b:v', '0', '-pix_fmt', 'yuv420p'];
    case 'h264_amf':
      return [
        '-c:v',
        'h264_amf',
        '-usage',
        'transcoding',
        '-quality',
        'speed',
        '-rc',
        'qvbr',
        '-qvbr_quality_level',
        '30',
        '-pix_fmt',
        'nv12'
      ];
    case 'h264_qsv':
      return [
        '-c:v',
        'h264_qsv',
        '-preset',
        'veryfast',
        '-global_quality',
        '32',
        '-look_ahead',
        '0',
        '-pix_fmt',
        'nv12',
        '-g',
        '24',
        '-vf',
        'scale=640:-2,fps=12',
        '-b:a',
        '96k',
        '-ac',
        '1',
        '-movflags',
        '+faststart',
      ];
    case 'libx264':
      return plan.weakMachine
        ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p'];
  }
}

export function buildPreviewEncodeArgs(
  inputPath: string,
  outputPath: string,
  plan: PreviewEncodePlan
): string[] {
  const args = ['-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a?'];

  if (plan.weakMachine) {
    args.push('-vf', PREVIEW_WEAK_SCALE_FILTER);
  }

  args.push(
    ...buildPreviewVideoArgs(plan),
    '-c:a',
    'aac',
    '-b:a',
    plan.weakMachine ? PREVIEW_WEAK_AUDIO_BITRATE : PREVIEW_NORMAL_AUDIO_BITRATE,
    '-movflags',
    '+faststart',
    outputPath
  );

  return args;
}

export async function remuxPreviewWithProgress(
  inputPath: string,
  outputPath: string,
  options: PreviewFfmpegProgressOptions = {}
): Promise<void> {
  await runFfmpegWithProgress(
    [
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
    ],
    (event) => {
      const progressPercent = calculateTaskProgressPercent(
        event.outTimeSeconds ?? 0,
        options.mediaDurationSeconds
      );

      if (progressPercent !== null) {
        options.onProgress?.(progressPercent);
      } else if (event.progress === 'end') {
        options.onProgress?.(100);
      }
    }
  );
}

function isPreviewEncodePlanArray(
  value: PreviewEncodePlan[] | PreviewFfmpegProgressOptions | undefined
): value is PreviewEncodePlan[] {
  return Array.isArray(value);
}

function buildEncodeOptions(
  plansOrOptions: PreviewEncodePlan[] | PreviewFfmpegProgressOptions | undefined,
  maybeOptions: PreviewFfmpegProgressOptions | undefined
): PreviewFfmpegProgressOptions | undefined {
  return isPreviewEncodePlanArray(plansOrOptions) ? maybeOptions : plansOrOptions;
}

function buildEncodePlans(
  plansOrOptions: PreviewEncodePlan[] | PreviewFfmpegProgressOptions | undefined
): PreviewEncodePlan[] | undefined {
  return isPreviewEncodePlanArray(plansOrOptions) ? plansOrOptions : undefined;
}

async function encodePreviewWithProgress(
  inputPath: string,
  outputPath: string,
  plans: PreviewEncodePlan[],
  options: PreviewFfmpegProgressOptions = {}
): Promise<void> {
  let lastError: unknown = null;

  for (const plan of plans) {
    try {
      await runFfmpegWithProgress(buildPreviewEncodeArgs(inputPath, outputPath, plan), (event) => {
        const progressPercent = calculateTaskProgressPercent(
          event.outTimeSeconds ?? 0,
          options.mediaDurationSeconds
        );

        if (progressPercent !== null) {
          options.onProgress?.(progressPercent);
        } else if (event.progress === 'end') {
          options.onProgress?.(100);
        }
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('No preview encoders were available.');
}

export async function remuxPreview(
  inputPath: string,
  outputPath: string,
  options?: PreviewFfmpegProgressOptions
): Promise<void> {
  if (options?.onProgress) {
    await remuxPreviewWithProgress(inputPath, outputPath, options);
    return;
  }

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

export async function encodePreviewWithPlans(
  inputPath: string,
  outputPath: string,
  plans: PreviewEncodePlan[],
  runCommandImpl: (command: string, args: string[]) => Promise<CommandResult> = runCommand
): Promise<void> {
  let lastError: unknown = null;

  for (const plan of plans) {
    try {
      await runCommandImpl('ffmpeg', buildPreviewEncodeArgs(inputPath, outputPath, plan));
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('No preview encoders were available.');
}

export async function encodePreview(
  inputPath: string,
  outputPath: string,
  plansOrOptions?: PreviewEncodePlan[] | PreviewFfmpegProgressOptions,
  maybeOptions?: PreviewFfmpegProgressOptions
): Promise<void> {
  const plans = buildEncodePlans(plansOrOptions);
  const options = buildEncodeOptions(plansOrOptions, maybeOptions);
  const resolvedPlans = plans && plans.length > 0 ? plans : await resolveEncodePlans();

  if (options?.onProgress) {
    await encodePreviewWithProgress(inputPath, outputPath, resolvedPlans, options);
    return;
  }

  await encodePreviewWithPlans(inputPath, outputPath, resolvedPlans);
}

export async function preparePreviewPlayback(
  inputPath: string,
  dependencies: PreviewPreparationDependencies = createDefaultPreviewPreparationDependencies(),
  onProgress?: (event: PreviewPreparationProgressEvent) => void
): Promise<PreviewPreparationResult> {
  const resolvedInputPath = path.resolve(inputPath);
  const extension = path.extname(resolvedInputPath).toLowerCase();

  emitPreviewPreparationProgress(onProgress, {
    phase: 'check-format',
    message: 'Checking video format...',
    percent: 15
  });

  if (isDirectPlayExtension(extension)) {
    emitPreviewPreparationProgress(onProgress, {
      phase: 'finalize',
      message: 'Opening original file...',
      percent: 95
    });

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

  const logicalCpuCount = dependencies.getLogicalCpuCount();
  const encodePlans = await dependencies.resolveEncodePlans(logicalCpuCount);
  const preferredPlan = encodePlans[0];

  if (!preferredPlan) {
    throw new Error('Unable to determine a preview encoding strategy.');
  }

  const inputStats = await dependencies.getInputStats(resolvedInputPath);
  const cacheKey = buildPreviewCacheKey(resolvedInputPath, inputStats, preferredPlan.profile);
  const previewPath = path.join(cacheDirectory, `${cacheKey}.preview.mp4`);

  emitPreviewPreparationProgress(onProgress, {
    phase: 'check-cache',
    message: 'Checking preview cache...',
    percent: 25
  });

  if (await dependencies.pathExists(previewPath)) {
    emitPreviewPreparationProgress(onProgress, {
      phase: 'check-cache',
      message: 'Using cached preview...',
      percent: 80
    });
    emitPreviewPreparationProgress(onProgress, {
      phase: 'finalize',
      message: 'Finalizing preview...',
      percent: 95
    });

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
    const mediaDurationSeconds = getPreviewDurationSeconds(probeResponse);

    if (canRemuxToBrowserSafeMp4(probeResponse)) {
      try {
        emitPreviewPreparationProgress(onProgress, {
          phase: 'remux',
          message: 'Remuxing browser-safe preview...',
          percent: 35
        });

        await dependencies.remuxPreview(resolvedInputPath, temporaryPreviewPath, {
          mediaDurationSeconds,
          onProgress: (progressPercent) => {
            emitPreviewPreparationProgress(onProgress, {
              phase: 'remux',
              message: 'Remuxing browser-safe preview...',
              percent: mapProgressToRange(progressPercent, 35, 90)
            });
          }
        });
      } catch {
        emitPreviewPreparationProgress(onProgress, {
          phase: 'encode',
          message: 'Encoding browser-safe preview...',
          percent: 35
        });

        await dependencies.encodePreview(resolvedInputPath, temporaryPreviewPath, encodePlans, {
          mediaDurationSeconds,
          onProgress: (progressPercent) => {
            emitPreviewPreparationProgress(onProgress, {
              phase: 'encode',
              message: 'Encoding browser-safe preview...',
              percent: mapProgressToRange(progressPercent, 35, 90)
            });
          }
        });
      }
    } else {
      emitPreviewPreparationProgress(onProgress, {
        phase: 'encode',
        message: 'Encoding browser-safe preview...',
        percent: 35
      });

      await dependencies.encodePreview(resolvedInputPath, temporaryPreviewPath, encodePlans, {
        mediaDurationSeconds,
        onProgress: (progressPercent) => {
          emitPreviewPreparationProgress(onProgress, {
            phase: 'encode',
            message: 'Encoding browser-safe preview...',
            percent: mapProgressToRange(progressPercent, 35, 90)
          });
        }
      });
    }

    emitPreviewPreparationProgress(onProgress, {
      phase: 'finalize',
      message: 'Finalizing preview...',
      percent: 95
    });

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
