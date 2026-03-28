import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FilterValidationError,
  buildKeptSpans,
  buildTimeline,
  parseFilterFile,
  type KeptSpan
} from '@cleanvid/shared';
import { probeMedia, runFfmpegWithProgress } from './ffmpeg.js';

export type ProcessMediaPhase =
  | 'read-filters'
  | 'probe-media'
  | 'plan-timeline'
  | 'build-graph'
  | 'encode'
  | 'done';

export interface ProcessMediaProgressEvent {
  phase: ProcessMediaPhase;
  message: string;
  percent?: number;
  outTimeSeconds?: number;
  totalDurationSeconds?: number;
  speed?: string;
  frame?: number;
  fps?: number;
}

function formatSeconds(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function buildAudioChain(span: KeptSpan, index: number, graphParts: string[]): string {
  const baseLabel = `a_trim_${index}`;
  graphParts.push(
    `[0:a:0]atrim=start=${formatSeconds(span.start)}:end=${formatSeconds(span.end)},asetpts=PTS-STARTPTS[${baseLabel}]`
  );

  let currentLabel = baseLabel;

  span.muteRanges.forEach((muteRange, muteIndex) => {
    const nextLabel = `a_${index}_mute_${muteIndex}`;
    graphParts.push(
      `[${currentLabel}]volume=0:enable='between(t,${formatSeconds(muteRange.start)},${formatSeconds(muteRange.end)})'[${nextLabel}]`
    );
    currentLabel = nextLabel;
  });

  return currentLabel;
}

export function buildFilterGraph(spans: KeptSpan[]): string {
  const graphParts: string[] = [];
  const concatInputs: string[] = [];

  spans.forEach((span, index) => {
    const videoLabel = `v_${index}`;
    const audioLabel = buildAudioChain(span, index, graphParts);

    graphParts.push(
      `[0:v:0]trim=start=${formatSeconds(span.start)}:end=${formatSeconds(span.end)},setpts=PTS-STARTPTS[${videoLabel}]`
    );

    concatInputs.push(`[${videoLabel}]`, `[${audioLabel}]`);
  });

  if (spans.length === 1) {
    graphParts.push(`${concatInputs[0]}null[outv]`);
    graphParts.push(`${concatInputs[1]}anull[outa]`);
  } else {
    graphParts.push(`${concatInputs.join('')}concat=n=${spans.length}:v=1:a=1[outv][outa]`);
  }

  return graphParts.join(';');
}

async function readFilterFile(filtersPath: string) {
  try {
    const raw = await readFile(filtersPath, 'utf8');
    return parseFilterFile(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in filter file: ${error.message}`);
    }

    if (error instanceof FilterValidationError) {
      throw new Error(`Invalid filter file: ${error.message}`);
    }

    throw error;
  }
}

export interface ProcessMediaOptions {
  inputPath: string;
  filtersPath: string;
  outputPath: string;
  onProgress?: (event: ProcessMediaProgressEvent) => void;
}

function emitProgress(
  onProgress: ProcessMediaOptions['onProgress'],
  event: ProcessMediaProgressEvent
) {
  if (!onProgress) {
    return;
  }

  try {
    onProgress(event);
  } catch {
    // Progress reporting is best-effort and should not fail the processing pipeline.
  }
}

export function getExpectedDurationSeconds(spans: KeptSpan[]): number {
  return spans.reduce((total, span) => total + (span.end - span.start), 0);
}

export function calculateProgressPercent(outTimeSeconds: number, totalDurationSeconds: number): number {
  if (!Number.isFinite(outTimeSeconds) || outTimeSeconds < 0 || totalDurationSeconds <= 0) {
    return 0;
  }

  return Math.min(outTimeSeconds / totalDurationSeconds, 1);
}

export async function processMedia(options: ProcessMediaOptions): Promise<void> {
  const inputPath = path.resolve(options.inputPath);
  const filtersPath = path.resolve(options.filtersPath);
  const outputPath = path.resolve(options.outputPath);
  const { onProgress } = options;

  emitProgress(onProgress, {
    phase: 'read-filters',
    message: 'Reading filters...'
  });
  const filterFile = await readFilterFile(filtersPath);

  emitProgress(onProgress, {
    phase: 'probe-media',
    message: 'Probing media...'
  });
  const mediaInfo = await probeMedia(inputPath);

  if (!mediaInfo.hasVideo) {
    throw new Error('Input media must contain a video stream.');
  }

  if (!mediaInfo.hasAudio) {
    throw new Error('Input media must contain an audio stream.');
  }

  emitProgress(onProgress, {
    phase: 'plan-timeline',
    message: 'Planning timeline...'
  });
  const timeline = buildTimeline(filterFile.filters, mediaInfo.duration);
  const spans = buildKeptSpans(timeline);

  if (spans.length === 0) {
    throw new Error('Filters remove the entire movie. No output can be produced.');
  }

  const skipCount = filterFile.filters.filter((segment) => segment.type === 'skip').length;
  const muteCount = filterFile.filters.filter((segment) => segment.type === 'mute').length;
  const expectedDurationSeconds = getExpectedDurationSeconds(spans);

  emitProgress(onProgress, {
    phase: 'plan-timeline',
    message: `Timeline ready: ${skipCount} skip region${skipCount === 1 ? '' : 's'} removed, ${muteCount} mute region${muteCount === 1 ? '' : 's'} retained across ${spans.length} kept span${spans.length === 1 ? '' : 's'}.`
  });
  emitProgress(onProgress, {
    phase: 'build-graph',
    message: 'Building FFmpeg filter graph...'
  });
  const filterComplex = buildFilterGraph(spans);
  const args = [
    '-y',
    '-i',
    inputPath,
    '-filter_complex',
    filterComplex,
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    outputPath
  ];

  try {
    emitProgress(onProgress, {
      phase: 'encode',
      message: 'Encoding output...'
    });
    await runFfmpegWithProgress(args, (event) => {
      const outTimeSeconds = event.outTimeSeconds ?? 0;

      emitProgress(onProgress, {
        phase: 'encode',
        message: 'Encoding output...',
        percent:
          event.progress === 'end'
            ? 1
            : calculateProgressPercent(outTimeSeconds, expectedDurationSeconds),
        outTimeSeconds,
        totalDurationSeconds: expectedDurationSeconds,
        speed: event.speed,
        frame: event.frame,
        fps: event.fps
      });
    });
    emitProgress(onProgress, {
      phase: 'done',
      message: 'Processing complete.'
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`FFmpeg processing failed: ${error.message}`);
    }

    throw error;
  }
}
