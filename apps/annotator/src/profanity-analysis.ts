import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildProfanitySuggestions,
  buildTranscriptProfanitySuggestions,
  mergeProfanitySuggestions,
  type ProfanityAnalysisProgressEvent,
  type ProfanityAnalysisResult,
  type ProfanitySuggestionSource,
  type TimedTextCue
} from '@cleanvid/shared';
import { runCommand } from '../../cli/src/ffmpeg.js';
import { checkMtsTranscriptMedia, parseMtsTranscript, toTimedTranscriptSegments } from './mts-transcript.js';

interface SubtitleStreamInfo {
  index: number;
  codec_name?: string;
  codec_type?: string;
  tags?: {
    language?: string;
    title?: string;
  };
}

interface ProbeResponse {
  streams?: SubtitleStreamInfo[];
  format?: {
    duration?: string;
    size?: string;
  };
}

export interface AnalyzeProfanityRequest {
  inputPath: string;
  movieTitle?: string;
  subtitlePath?: string;
  onProgress?: (event: ProfanityAnalysisProgressEvent) => void;
}

export interface AnalyzeProfanityDependencies {
  probeSubtitleStreams: (inputPath: string) => Promise<{ duration: number; streams: SubtitleStreamInfo[]; sizeBytes?: number }>;
  extractEmbeddedSubtitleCues: (inputPath: string, streams: SubtitleStreamInfo[]) => Promise<TimedTextCue[] | null>;
  loadProvidedSubtitleCues: (subtitlePath: string) => Promise<TimedTextCue[] | null>;
  readTranscriptFile: (transcriptPath: string) => Promise<string>;
}

const TEXT_SUBTITLE_CODECS = new Set(['ass', 'mov_text', 'srt', 'ssa', 'subrip', 'text', 'webvtt']);
const DEFAULT_PROGRESS_PERCENTS: Record<ProfanityAnalysisProgressEvent['phase'], number> = {
  'probe-media': 5,
  'extract-embedded-subtitles': 20,
  'load-provided-subtitles': 38,
  'load-provided-transcript': 38,
  'normalize-text': 65,
  'detect-profanity': 82,
  'merge-detections': 96,
  done: 100
};

function emitProgress(
  onProgress: AnalyzeProfanityRequest['onProgress'],
  event: Omit<ProfanityAnalysisProgressEvent, 'percent'> & { percent?: number }
) {
  if (!onProgress) {
    return;
  }

  onProgress({
    ...event,
    percent: event.percent ?? DEFAULT_PROGRESS_PERCENTS[event.phase]
  });
}

function parseSrtTimestamp(value: string): number {
  const matches = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim());

  if (!matches) {
    return Number.NaN;
  }

  const [, hours, minutes, seconds, milliseconds] = matches;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000;
}

function parseAssTimestamp(value: string): number {
  const matches = /^(\d+):(\d{2}):(\d{2})[.](\d{2})$/.exec(value.trim());

  if (!matches) {
    return Number.NaN;
  }

  const [, hours, minutes, seconds, centiseconds] = matches;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(centiseconds) / 100;
}

function parseSrt(text: string): TimedTextCue[] {
  return text
    .trim()
    .split(/\r?\n\r?\n+/)
    .flatMap((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');

      if (lines.length < 2) {
        return [];
      }

      const timeLine = lines[1]?.includes('-->') ? lines[1] : lines[0];
      const textLines = timeLine === lines[1] ? lines.slice(2) : lines.slice(1);
      const [startText, endText] = timeLine.split('-->').map((value) => value.trim());
      const start = parseSrtTimestamp(startText);
      const end = parseSrtTimestamp(endText);

      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return [];
      }

      return [
        {
          start,
          end,
          text: textLines.join(' ').trim()
        }
      ];
    });
}

function parseVtt(text: string): TimedTextCue[] {
  return text
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .trim()
    .split(/\r?\n\r?\n+/)
    .flatMap((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');

      if (lines.length === 0) {
        return [];
      }

      const timeLine = lines.find((line) => line.includes('-->'));

      if (!timeLine) {
        return [];
      }

      const textLines = lines.slice(lines.indexOf(timeLine) + 1);
      const [startText, endText] = timeLine
        .split('-->')
        .map((value) => value.trim().split(/\s+/)[0] ?? '');
      const start = parseSrtTimestamp(startText.replace('.', ','));
      const end = parseSrtTimestamp(endText.replace('.', ','));

      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return [];
      }

      return [
        {
          start,
          end,
          text: textLines.join(' ').trim()
        }
      ];
    });
}

function parseAss(text: string): TimedTextCue[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.startsWith('Dialogue:')) {
        return [];
      }

      const fields = line.slice('Dialogue:'.length).split(',');

      if (fields.length < 10) {
        return [];
      }

      const start = parseAssTimestamp(fields[1] ?? '');
      const end = parseAssTimestamp(fields[2] ?? '');

      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return [];
      }

      const textValue = fields
        .slice(9)
        .join(',')
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\\N/g, ' ')
        .trim();

      return textValue === ''
        ? []
        : [
            {
              start,
              end,
              text: textValue
            }
          ];
    });
}

function parseSubtitleText(text: string, formatHint = ''): TimedTextCue[] {
  const format = formatHint.toLowerCase();

  if (format.endsWith('.vtt') || text.trimStart().startsWith('WEBVTT')) {
    return parseVtt(text);
  }

  if (format.endsWith('.ass') || format.endsWith('.ssa') || text.includes('[Script Info]')) {
    return parseAss(text);
  }

  return parseSrt(text);
}

function pickPreferredSubtitleStream(streams: SubtitleStreamInfo[]): SubtitleStreamInfo | null {
  const textStreams = streams.filter(
    (stream) =>
      stream.codec_type === 'subtitle' &&
      typeof stream.index === 'number' &&
      TEXT_SUBTITLE_CODECS.has((stream.codec_name ?? '').toLowerCase())
  );

  if (textStreams.length === 0) {
    return null;
  }

  return (
    textStreams.find((stream) => (stream.tags?.language ?? '').toLowerCase().startsWith('en')) ??
    textStreams[0]
  );
}

async function probeSubtitleStreams(inputPath: string) {
  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath
  ]);
  const parsed = JSON.parse(stdout) as ProbeResponse;
  const duration = Number(parsed.format?.duration);
  const size = Number(parsed.format?.size);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to determine media duration with ffprobe.');
  }

  return {
    duration,
    streams: parsed.streams ?? [],
    sizeBytes: Number.isSafeInteger(size) && size > 0 ? size : undefined
  };
}

async function extractEmbeddedSubtitleCues(
  inputPath: string,
  streams: SubtitleStreamInfo[]
): Promise<TimedTextCue[] | null> {
  const preferredStream = pickPreferredSubtitleStream(streams);

  if (!preferredStream) {
    return null;
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'cleanvid-subs-'));
  const subtitlePath = path.join(temporaryDirectory, `embedded-${preferredStream.index}.srt`);

  try {
    await runCommand('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-map',
      `0:${preferredStream.index}`,
      subtitlePath
    ]);

    const subtitleText = await readFile(subtitlePath, 'utf8');
    const cues = parseSubtitleText(subtitleText, subtitlePath);
    return cues.length > 0 ? cues : null;
  } catch {
    return null;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function loadProvidedSubtitleCues(subtitlePath: string): Promise<TimedTextCue[] | null> {
  const subtitleText = await readFile(subtitlePath, 'utf8');
  const cues = parseSubtitleText(subtitleText, subtitlePath);
  return cues.length > 0 ? cues : null;
}

function getDefaultAnalyzeProfanityDependencies(): AnalyzeProfanityDependencies {
  return {
    probeSubtitleStreams,
    extractEmbeddedSubtitleCues,
    loadProvidedSubtitleCues,
    readTranscriptFile: (transcriptPath) => readFile(transcriptPath, 'utf8')
  };
}

async function analyzeMtsTranscript(
  transcriptPath: string,
  request: AnalyzeProfanityRequest,
  media: Awaited<ReturnType<AnalyzeProfanityDependencies['probeSubtitleStreams']>>,
  readTranscriptFile: AnalyzeProfanityDependencies['readTranscriptFile']
): Promise<ProfanityAnalysisResult> {
  emitProgress(request.onProgress, {
    phase: 'load-provided-transcript',
    message: 'Loading the provided MTS transcript...'
  });
  const transcript = parseMtsTranscript(await readTranscriptFile(transcriptPath));
  const warnings = checkMtsTranscriptMedia(transcript, {
    inputPath: request.inputPath,
    duration: media.duration,
    sizeBytes: media.sizeBytes,
    firstAudioStreamIndex: media.streams.find((stream) => stream.codec_type === 'audio')?.index
  });

  emitProgress(request.onProgress, { phase: 'normalize-text', message: 'Preparing transcript text and word timestamps...' });
  const segments = toTimedTranscriptSegments(transcript);
  emitProgress(request.onProgress, { phase: 'detect-profanity', message: 'Detecting profanity in the transcript...' });
  const detected = buildTranscriptProfanitySuggestions(segments);
  emitProgress(request.onProgress, { phase: 'merge-detections', message: 'Merging overlapping draft mute ranges...' });
  const suggestions = mergeProfanitySuggestions(detected.suggestions, media.duration);
  const hasSpeech = segments.some((segment) => segment.text.trim() || segment.words.some((word) => word.text.trim()));
  const message = suggestions.length > 0
    ? draftSuggestionMessage(suggestions.length)
    : !hasSpeech
      ? 'No speech was transcribed.'
      : detected.warnings.length || detected.suggestions.length
        ? 'No draft mute ranges could be created. Review the transcript warnings.'
        : 'No profanity matches were detected in the transcript.';
  emitProgress(request.onProgress, { phase: 'done', message });

  return {
    suggestions,
    usedSources: ['transcript'],
    subtitleCueCount: 0,
    transcriptSegmentCount: segments.length,
    warnings: [...new Set([...warnings, ...detected.warnings])],
    message
  };
}

function draftSuggestionMessage(count: number): string {
  return `Detected ${count} draft mute suggestion${count === 1 ? '' : 's'}.`;
}

export async function analyzeProfanity(
  request: AnalyzeProfanityRequest,
  dependencies: AnalyzeProfanityDependencies = getDefaultAnalyzeProfanityDependencies()
): Promise<ProfanityAnalysisResult> {
  emitProgress(request.onProgress, {
    phase: 'probe-media',
    message: 'Analyzing the opened video and its streams...'
  });
  const media = await dependencies.probeSubtitleStreams(request.inputPath);
  const { duration, streams } = media;
  const providedPath = request.subtitlePath?.trim();

  if (providedPath && path.extname(providedPath).toLowerCase() === '.json') {
    return analyzeMtsTranscript(providedPath, request, media, dependencies.readTranscriptFile);
  }

  let subtitleSource: ProfanitySuggestionSource = 'embedded';
  let subtitleCues: TimedTextCue[] | null = null;

  if (providedPath) {
    emitProgress(request.onProgress, {
      phase: 'load-provided-subtitles',
      message: 'Loading the provided subtitle file...'
    });
    subtitleSource = 'provided';
    subtitleCues = await dependencies.loadProvidedSubtitleCues(providedPath);
  } else {
    emitProgress(request.onProgress, {
      phase: 'extract-embedded-subtitles',
      message: 'Extracting embedded subtitles...'
    });
    subtitleCues = await dependencies.extractEmbeddedSubtitleCues(request.inputPath, streams);
  }

  if (!subtitleCues || subtitleCues.length === 0) {
    throw new Error(
      'No usable subtitles were found. Choose a subtitle file (.srt, .vtt, .ass, .ssa) or a Media Transcription Studio transcript (.json) and try again.'
    );
  }

  emitProgress(request.onProgress, {
    phase: 'normalize-text',
    message: 'Normalizing subtitle text...'
  });

  emitProgress(request.onProgress, {
    phase: 'detect-profanity',
    message: 'Detecting profanity in subtitle text...'
  });
  const rawSuggestions = buildProfanitySuggestions(subtitleCues, subtitleSource);

  emitProgress(request.onProgress, {
    phase: 'merge-detections',
    message: 'Merging profanity detections into draft mute suggestions...'
  });
  const suggestions = mergeProfanitySuggestions(rawSuggestions, duration);
  const message =
    suggestions.length === 0
      ? 'No profanity matches were detected in the subtitles.'
      : draftSuggestionMessage(suggestions.length);

  emitProgress(request.onProgress, {
    phase: 'done',
    message
  });

  return {
    suggestions,
    usedSources: [subtitleSource],
    subtitleCueCount: subtitleCues.length,
    message
  };
}
