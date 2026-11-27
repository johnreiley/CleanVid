import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildProfanitySuggestions,
  buildTranscriptProfanitySuggestions,
  mergeProfanitySuggestions,
  reconcileProfanity,
  type EmbeddedSubtitleTrack,
  type ProfanityAnalysisOptions,
  type ProfanityAnalysisProgressEvent,
  type ProfanityAnalysisResult,
  type TimedTextCue
} from '@cleanvid/shared';
import { runCommand } from '../../cli/src/ffmpeg.js';
import { checkMtsTranscriptMedia, parseMtsTranscript, toTimedTranscriptSegments } from './mts-transcript.js';

interface SubtitleStreamInfo {
  index: number;
  codec_name?: string;
  codec_type?: string;
  disposition?: { forced?: number; default?: number };
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

export interface AnalyzeProfanityRequest extends ProfanityAnalysisOptions {
  inputPath: string;
  movieTitle?: string;
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
  'load-provided-subtitles': 48,
  'load-provided-transcript': 38,
  'normalize-text': 65,
  'detect-profanity': 73,
  'align-sources': 81,
  'reconcile-detections': 92,
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
      if (!timeLine.includes('-->')) return [];
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
      const timestamp = (value: string) => parseSrtTimestamp(value.split(':').length === 2 ? `00:${value}` : value);
      const start = timestamp(startText);
      const end = timestamp(endText);

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

function textSubtitleStreams(streams: SubtitleStreamInfo[]): SubtitleStreamInfo[] {
  return streams.filter((stream) => stream.codec_type === 'subtitle' &&
    TEXT_SUBTITLE_CODECS.has((stream.codec_name ?? '').toLowerCase()));
}

function preferredSubtitleStream(streams: SubtitleStreamInfo[]): SubtitleStreamInfo | undefined {
  const eligible = streams.filter((stream) => !stream.disposition?.forced &&
    !/\bforced\b/i.test(stream.tags?.title ?? ''));
  const english = eligible.filter((stream) => /^(en|eng|english)([-_]|$)/i.test(stream.tags?.language ?? ''));
  const untagged = eligible.filter((stream) => /^(und)?$/i.test(stream.tags?.language ?? ''));
  const candidates = english.length ? english : untagged;
  if (candidates.length === 1) return candidates[0];
  const defaults = english.filter((stream) => stream.disposition?.default);
  return defaults.length === 1 ? defaults[0] : undefined;
}

function describeSubtitleTracks(tracks: SubtitleStreamInfo[]): EmbeddedSubtitleTrack[] {
  return tracks.map((track) => ({
    index: track.index, language: track.tags?.language, title: track.tags?.title,
    forced: Boolean(track.disposition?.forced || /\bforced\b/i.test(track.tags?.title ?? ''))
  }));
}

export async function listEmbeddedSubtitleTracks(inputPath: string): Promise<EmbeddedSubtitleTrack[]> {
  const { streams } = await probeSubtitleStreams(inputPath);
  return describeSubtitleTracks(textSubtitleStreams(streams));
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
  const preferredStream = streams[0];

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

function draftSuggestionMessage(count: number): string {
  return `Detected ${count} draft mute suggestion${count === 1 ? '' : 's'}.`;
}

export async function analyzeProfanity(
  request: AnalyzeProfanityRequest,
  dependencies: AnalyzeProfanityDependencies = getDefaultAnalyzeProfanityDependencies()
): Promise<ProfanityAnalysisResult> {
  emitProgress(request.onProgress, { phase: 'probe-media', message: 'Analyzing the opened video and its streams...' });
  const media = await dependencies.probeSubtitleStreams(request.inputPath);
  const { duration, streams } = media;
  const subtitlePath = request.subtitlePath?.trim();
  const legacyJson = subtitlePath && path.extname(subtitlePath).toLowerCase() === '.json';
  const transcriptPath = request.transcriptPath?.trim() || (legacyJson ? subtitlePath : undefined);
  if (legacyJson && request.transcriptPath?.trim() && request.transcriptPath.trim() !== subtitlePath) {
    throw new Error('Two MTS transcript paths were supplied. Select one transcript and retry.');
  }
  const mode = request.subtitleMode ?? (legacyJson ? 'none' : subtitlePath ? 'external' : 'auto');
  const tracks = textSubtitleStreams(streams);
  const subtitleTracks = describeSubtitleTracks(tracks);
  const warnings: string[] = [];
  let transcriptDetails: ProfanityAnalysisResult['transcriptDetails'];
  let segments: ReturnType<typeof toTimedTranscriptSegments> = [];
  let transcriptWarnings: string[] = [];
  if (transcriptPath) {
    emitProgress(request.onProgress, { phase: 'load-provided-transcript', message: 'Loading and validating the MTS transcript...' });
    const transcript = parseMtsTranscript(await dependencies.readTranscriptFile(transcriptPath));
    transcriptWarnings = checkMtsTranscriptMedia(transcript, {
      inputPath: request.inputPath,
      duration,
      sizeBytes: media.sizeBytes,
      firstAudioStreamIndex: streams.find((stream) => stream.codec_type === 'audio')?.index
    });
    transcriptDetails = {
      fileName: transcript.source.fileName, model: transcript.engine.model,
      audioStreamIndex: transcript.source.audioStreamIndex,
      completedChunks: transcript.coverage.completedChunks, expectedChunks: transcript.coverage.expectedChunks
    };
    segments = toTimedTranscriptSegments(transcript);
  }

  const external = mode !== 'none' && (mode === 'external' || Boolean(subtitlePath && !legacyJson));
  const subtitleSource: 'provided' | 'embedded' = external ? 'provided' : 'embedded';
  let cues: TimedTextCue[] = [];
  if (external) {
    if (!subtitlePath || legacyJson) throw new Error('Choose a subtitle file (.srt, .vtt, .ass, .ssa) for external subtitle analysis.');
    emitProgress(request.onProgress, { phase: 'load-provided-subtitles', message: 'Loading the provided subtitle file...' });
    cues = await dependencies.loadProvidedSubtitleCues(subtitlePath) ?? [];
    if (!cues.length) throw new Error('The selected subtitle file contains no readable cues. Choose another file or set subtitles to None and retry.');
  } else if (mode === 'auto') {
    const selected = request.subtitleStreamIndex === undefined
      ? preferredSubtitleStream(tracks)
      : tracks.find((track) => track.index === request.subtitleStreamIndex);
    if (!selected && request.subtitleStreamIndex !== undefined) {
      throw new Error('The selected embedded subtitle track is unavailable. Choose another track and retry.');
    }
    if (selected) {
      emitProgress(request.onProgress, { phase: 'extract-embedded-subtitles', message: 'Extracting embedded subtitles...' });
      cues = await dependencies.extractEmbeddedSubtitleCues(request.inputPath, [selected]) ?? [];
      if (!cues.length && request.subtitleStreamIndex !== undefined) {
        throw new Error('The selected embedded subtitle track contains no readable cues. Choose another track or set subtitles to None.');
      }
      if (cues.length && /^(und)?$/i.test(selected.tags?.language ?? '')) {
        warnings.push('The embedded subtitle track has no language tag. Verify that it contains English dialogue.');
      }
    } else if (tracks.length > 0) {
      warnings.push('No embedded English track could be selected automatically. Choose a track manually or use an external subtitle file.');
    }
  }

  // Only playable cues can contribute evidence. Keep original timestamps for cues
  // that intersect the video so synchronization and range clamping remain separate.
  if (cues.some((cue) => cue.end <= 0 || cue.start >= duration) && !transcriptPath) {
    cues = cues.filter((cue) => cue.end > 0 && cue.start < duration);
    warnings.push('Some subtitle cues are outside the video timeline.');
    if (!cues.length && external) throw new Error('The selected subtitle file has no cues within the video. Verify its timing and retry.');
  }

  if (!cues.length && !transcriptPath) {
    if (warnings.length) throw new Error(warnings[0]);
    if (mode === 'none') throw new Error('Choose an MTS transcript or enable subtitles before analyzing profanity.');
    throw new Error('No usable subtitles were found. Choose a subtitle file (.srt, .vtt, .ass, .ssa) or a Media Transcription Studio transcript (.json) and try again.');
  }
  if (!cues.length && mode === 'auto' && !warnings.length) {
    warnings.push('No usable embedded subtitles were found. Analysis used the transcript only.');
  }

  const dual = cues.length > 0 && Boolean(transcriptPath);
  const hasSpeech = segments.some((segment) => segment.text.trim() || segment.words.some((word) => word.text.trim()));
  if (dual && !hasSpeech) warnings.push('The MTS transcript contains no transcribed speech.');
  emitProgress(request.onProgress, { phase: 'normalize-text', message: 'Preparing source text and timestamps...' });
  emitProgress(request.onProgress, { phase: 'detect-profanity', message: 'Detecting profanity in the available sources...' });
  if (dual) emitProgress(request.onProgress, { phase: 'align-sources', message: 'Aligning dialogue in the subtitles and transcript...' });
  const reconciled = reconcileProfanity({
    cues, subtitleSource, segments, hasTranscript: Boolean(transcriptPath), duration,
    subtitleOffset: request.subtitleOffset, estimateMissingWords: request.estimateMissingWords,
    wordPadding: request.wordPadding, validationWarnings: dual ? [...warnings, ...transcriptWarnings] : transcriptWarnings,
    onReconcile: () => {
      if (dual) emitProgress(request.onProgress, { phase: 'reconcile-detections', message: 'Reconciling evidence and classifying review items...' });
    }
  });
  const detected = transcriptPath && !dual ? buildTranscriptProfanitySuggestions(segments) : undefined;
  if (!dual) emitProgress(request.onProgress, { phase: 'merge-detections', message: 'Merging overlapping draft mute ranges...' });
  const suggestions = dual ? [] : mergeProfanitySuggestions(detected?.suggestions ?? buildProfanitySuggestions(cues, subtitleSource), duration);
  const count = dual ? reconciled.detections.length : suggestions.length;
  const message = dual
    ? `Detected ${count} profanity occurrence${count === 1 ? '' : 's'} across both sources.`
    : count > 0 ? draftSuggestionMessage(count)
      : !transcriptPath ? 'No profanity matches were detected in the subtitles.'
        : !hasSpeech ? 'No speech was transcribed.'
          : reconciled.detections.length ? 'No draft mute ranges could be created. Review the transcript detections.'
            : 'No profanity matches were detected in the transcript.';
  emitProgress(request.onProgress, { phase: 'done', message });

  return {
    suggestions,
    detections: reconciled.detections,
    subtitleAlignment: reconciled.subtitleAlignment,
    usedSources: [...(cues.length ? [subtitleSource] : []), ...(transcriptPath ? ['transcript' as const] : [])],
    subtitleTracks,
    subtitleCueCount: cues.length,
    transcriptSegmentCount: transcriptPath ? segments.length : undefined,
    transcriptDetails,
    warnings: [...new Set([...warnings, ...transcriptWarnings, ...(detected?.warnings ?? reconciled.warnings)])],
    message
  };
}
