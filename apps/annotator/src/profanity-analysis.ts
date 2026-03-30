import { gunzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildProfanitySuggestions,
  mergeProfanitySuggestions,
  subtitlesLookIncomplete,
  type ProfanityAnalysisCapabilities,
  type ProfanityAnalysisOptions,
  type ProfanityAnalysisProgressEvent,
  type ProfanityAnalysisResult,
  type ProfanitySuggestionSource,
  type TimedTextCue
} from '@cleanvid/shared';
import { runCommand } from '../../cli/src/ffmpeg.js';

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
  };
}

interface OpenSubtitlesConfig {
  apiKey: string;
  password: string;
  userAgent: string;
  username: string;
}

export interface AnalyzeProfanityRequest {
  inputPath: string;
  movieTitle?: string;
  options: ProfanityAnalysisOptions;
  onProgress?: (event: ProfanityAnalysisProgressEvent) => void;
}

export interface AnalyzeProfanityDependencies {
  probeSubtitleStreams: (inputPath: string) => Promise<{ duration: number; streams: SubtitleStreamInfo[] }>;
  extractEmbeddedSubtitleCues: (inputPath: string, streams: SubtitleStreamInfo[]) => Promise<TimedTextCue[] | null>;
  fetchRemoteSubtitleCues: (request: {
    inputPath: string;
    movieTitle: string;
    duration: number;
  }) => Promise<TimedTextCue[] | null>;
  transcribeWithWhisper: (inputPath: string, model: 'tiny' | 'base') => Promise<TimedTextCue[]>;
  getCapabilities: () => ProfanityAnalysisCapabilities;
}

const TEXT_SUBTITLE_CODECS = new Set(['ass', 'mov_text', 'srt', 'ssa', 'subrip', 'text', 'webvtt']);
const DEFAULT_PROGRESS_PERCENTS: Record<ProfanityAnalysisProgressEvent['phase'], number> = {
  'probe-media': 5,
  'extract-embedded-subtitles': 15,
  'fetch-remote-subtitles': 30,
  'transcribe-tiny': 52,
  'transcribe-base': 65,
  'normalize-text': 78,
  'detect-profanity': 88,
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

function normalizeLookupTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getOpenSubtitlesConfig(): OpenSubtitlesConfig | null {
  const apiKey = process.env.CLEANVID_OPENSUBTITLES_API_KEY?.trim() ?? '';
  const username = process.env.CLEANVID_OPENSUBTITLES_USERNAME?.trim() ?? '';
  const password = process.env.CLEANVID_OPENSUBTITLES_PASSWORD?.trim() ?? '';

  if (apiKey === '' || username === '' || password === '') {
    return null;
  }

  return {
    apiKey,
    username,
    password,
    userAgent: 'CleanVid/0.1.0'
  };
}

function getWhisperBinaryPath(): string {
  return process.env.CLEANVID_WHISPER_CPP_BIN?.trim() ?? '';
}

function hasWhisperModelConfiguration(model: 'tiny' | 'base'): boolean {
  return getWhisperBinaryPath() !== '' && getWhisperModelPath(model) !== '';
}

function getWhisperSetupInstructions(model: 'tiny' | 'base'): string {
  const explicitModelEnv =
    model === 'tiny' ? 'CLEANVID_WHISPER_CPP_TINY_MODEL' : 'CLEANVID_WHISPER_CPP_BASE_MODEL';
  const bundledModelName = model === 'tiny' ? 'ggml-tiny.en.bin' : 'ggml-base.en.bin';

  return `Set CLEANVID_WHISPER_CPP_BIN and ${explicitModelEnv}, or set CLEANVID_WHISPER_CPP_MODELS_DIR so ${bundledModelName} can be found there.`;
}

function getWhisperModelPath(model: 'tiny' | 'base'): string {
  const explicit =
    model === 'tiny'
      ? process.env.CLEANVID_WHISPER_CPP_TINY_MODEL?.trim() ?? ''
      : process.env.CLEANVID_WHISPER_CPP_BASE_MODEL?.trim() ?? '';

  if (explicit !== '') {
    return explicit;
  }

  const modelsDirectory = process.env.CLEANVID_WHISPER_CPP_MODELS_DIR?.trim() ?? '';

  if (modelsDirectory === '') {
    return '';
  }

  return path.join(modelsDirectory, model === 'tiny' ? 'ggml-tiny.en.bin' : 'ggml-base.en.bin');
}

export function getProfanityAnalysisCapabilities(): ProfanityAnalysisCapabilities {
  return {
    remoteSubtitlesAvailable: getOpenSubtitlesConfig() !== null,
    whisperBaseAvailable: hasWhisperModelConfiguration('base'),
    whisperTinyAvailable: hasWhisperModelConfiguration('tiny')
  };
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

async function probeSubtitleStreams(inputPath: string): Promise<{ duration: number; streams: SubtitleStreamInfo[] }> {
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

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to determine media duration with ffprobe.');
  }

  return {
    duration,
    streams: parsed.streams ?? []
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

function buildOpenSubtitlesHeaders(config: OpenSubtitlesConfig, token?: string): HeadersInit {
  return {
    'Api-Key': config.apiKey,
    Authorization: token ? `Bearer ${token}` : '',
    'Content-Type': 'application/json',
    'User-Agent': config.userAgent
  };
}

function scoreRemoteCandidate(candidate: unknown, requestedTitle: string): { fileId: number; score: number } | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const attributes =
    typeof record.attributes === 'object' && record.attributes !== null
      ? (record.attributes as Record<string, unknown>)
      : {};
  const files = Array.isArray(attributes.files) ? attributes.files : [];
  const firstFile =
    files.length > 0 && typeof files[0] === 'object' && files[0] !== null
      ? (files[0] as Record<string, unknown>)
      : null;
  const fileId = Number(firstFile?.file_id);

  if (!Number.isFinite(fileId)) {
    return null;
  }

  const featureDetails =
    typeof attributes.feature_details === 'object' && attributes.feature_details !== null
      ? (attributes.feature_details as Record<string, unknown>)
      : {};
  const title = normalizeLookupTitle(
    String(
      featureDetails.movie_name ??
        attributes.release ??
        attributes.file_name ??
        record.id ??
        ''
    )
  );
  const language = String(attributes.language ?? '').toLowerCase();

  let score = 0;

  if (title === requestedTitle) {
    score += 10;
  } else if (title.includes(requestedTitle) || requestedTitle.includes(title)) {
    score += 6;
  }

  if (language.includes('english') || language === 'en') {
    score += 2;
  }

  score += Number(attributes.download_count ?? 0) / 1000;

  return { fileId, score };
}

function decodeRemoteSubtitleBody(
  body: Buffer,
  contentEncoding: string | null,
  link: string
): string {
  const looksGzipped = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;

  if (looksGzipped || contentEncoding === 'gzip' || link.toLowerCase().endsWith('.gz')) {
    return gunzipSync(body).toString('utf8');
  }

  return body.toString('utf8');
}

async function fetchRemoteSubtitleCues(request: {
  inputPath: string;
  movieTitle: string;
  duration: number;
}): Promise<TimedTextCue[] | null> {
  const config = getOpenSubtitlesConfig();

  if (!config) {
    return null;
  }

  const loginResponse = await fetch('https://api.opensubtitles.com/api/v1/login', {
    method: 'POST',
    headers: buildOpenSubtitlesHeaders(config),
    body: JSON.stringify({
      username: config.username,
      password: config.password
    })
  });

  if (!loginResponse.ok) {
    return null;
  }

  const loginPayload = (await loginResponse.json()) as {
    base_url?: string;
    token?: string;
  };
  const baseUrl = loginPayload.base_url?.trim() || 'api.opensubtitles.com';
  const token = loginPayload.token?.trim() || '';

  if (token === '') {
    return null;
  }

  const requestedTitle = normalizeLookupTitle(
    request.movieTitle || path.parse(request.inputPath).name || 'movie'
  );
  const searchUrl = new URL(`https://${baseUrl}/api/v1/subtitles`);
  searchUrl.searchParams.set('languages', 'en');
  searchUrl.searchParams.set('query', requestedTitle);
  searchUrl.searchParams.set('order_by', 'download_count');
  searchUrl.searchParams.set('order_direction', 'desc');
  searchUrl.searchParams.set('type', 'movie');

  const searchResponse = await fetch(searchUrl, {
    headers: buildOpenSubtitlesHeaders(config, token)
  });

  if (!searchResponse.ok) {
    return null;
  }

  const searchPayload = (await searchResponse.json()) as { data?: unknown[] };
  const bestCandidate = (searchPayload.data ?? [])
    .map((candidate) => scoreRemoteCandidate(candidate, requestedTitle))
    .filter((candidate): candidate is { fileId: number; score: number } => candidate !== null)
    .sort((left, right) => right.score - left.score)[0];

  if (!bestCandidate || bestCandidate.score < 6) {
    return null;
  }

  const downloadResponse = await fetch(`https://${baseUrl}/api/v1/download`, {
    method: 'POST',
    headers: buildOpenSubtitlesHeaders(config, token),
    body: JSON.stringify({
      file_id: bestCandidate.fileId
    })
  });

  if (!downloadResponse.ok) {
    return null;
  }

  const downloadPayload = (await downloadResponse.json()) as {
    file_name?: string;
    link?: string;
  };
  const link = downloadPayload.link?.trim() ?? '';

  if (link === '') {
    return null;
  }

  const subtitleResponse = await fetch(link, {
    headers: {
      'User-Agent': config.userAgent
    }
  });

  if (!subtitleResponse.ok) {
    return null;
  }

  const body = Buffer.from(await subtitleResponse.arrayBuffer());
  const subtitleText = decodeRemoteSubtitleBody(body, subtitleResponse.headers.get('content-encoding'), link);
  const cues = parseSubtitleText(subtitleText, downloadPayload.file_name ?? link);
  return cues.length > 0 ? cues : null;
}

async function transcribeWithWhisper(
  inputPath: string,
  model: 'tiny' | 'base'
): Promise<TimedTextCue[]> {
  const whisperBinary = getWhisperBinaryPath();
  const whisperModel = getWhisperModelPath(model);

  if (whisperBinary === '') {
    throw new Error(
      `whisper.cpp ${model} is not configured. ${getWhisperSetupInstructions(model)}`
    );
  }

  if (whisperModel === '') {
    throw new Error(
      `whisper.cpp ${model} model is not configured. ${getWhisperSetupInstructions(model)}`
    );
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), `cleanvid-whisper-${model}-`));
  const audioPath = path.join(temporaryDirectory, `${model}.wav`);
  const outputBase = path.join(temporaryDirectory, `${model}-transcript`);

  try {
    await runCommand('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      audioPath
    ]);

    await runCommand(whisperBinary, [
      '-m',
      whisperModel,
      '-l',
      'en',
      '-osrt',
      '-of',
      outputBase,
      '-np',
      audioPath
    ]);

    const subtitleText = await readFile(`${outputBase}.srt`, 'utf8');
    const cues = parseSrt(subtitleText);

    if (cues.length === 0) {
      throw new Error(`whisper.cpp ${model} produced no subtitle cues.`);
    }

    return cues;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function getDefaultAnalyzeProfanityDependencies(): AnalyzeProfanityDependencies {
  return {
    probeSubtitleStreams,
    extractEmbeddedSubtitleCues,
    fetchRemoteSubtitleCues,
    transcribeWithWhisper,
    getCapabilities: getProfanityAnalysisCapabilities
  };
}

function uniqueSources(values: ProfanitySuggestionSource[]): ProfanitySuggestionSource[] {
  return Array.from(new Set(values));
}

export async function analyzeProfanity(
  request: AnalyzeProfanityRequest,
  dependencies: AnalyzeProfanityDependencies = getDefaultAnalyzeProfanityDependencies()
): Promise<ProfanityAnalysisResult> {
  emitProgress(request.onProgress, {
    phase: 'probe-media',
    message: 'Analyzing video and subtitle streams...'
  });
  const { duration, streams } = await dependencies.probeSubtitleStreams(request.inputPath);

  emitProgress(request.onProgress, {
    phase: 'extract-embedded-subtitles',
    message: 'Extracting embedded subtitles...'
  });
  let subtitleSource: ProfanitySuggestionSource | null = 'embedded';
  let subtitleCues = await dependencies.extractEmbeddedSubtitleCues(request.inputPath, streams);

  const capabilities = dependencies.getCapabilities();

  if (
    (!subtitleCues || subtitleCues.length === 0) &&
    request.options.allowRemoteSubtitles &&
    capabilities.remoteSubtitlesAvailable
  ) {
    emitProgress(request.onProgress, {
      phase: 'fetch-remote-subtitles',
      message: 'Fetching matching subtitles from OpenSubtitles...'
    });

    try {
      subtitleCues = await dependencies.fetchRemoteSubtitleCues({
        inputPath: request.inputPath,
        movieTitle: request.movieTitle?.trim() || path.parse(request.inputPath).name,
        duration
      });

      if (subtitleCues && subtitleCues.length > 0) {
        subtitleSource = 'remote';
      }
    } catch {
      subtitleCues = null;
    }
  }

  emitProgress(request.onProgress, {
    phase: 'normalize-text',
    message: 'Normalizing subtitle and transcript text...'
  });

  const collectedSources: ProfanitySuggestionSource[] = [];
  const rawSuggestions = [];
  let whisperRefinementApplied = false;
  let remoteLookupUsed = subtitleSource === 'remote';

  if (subtitleCues && subtitleCues.length > 0 && subtitleSource) {
    emitProgress(request.onProgress, {
      phase: 'detect-profanity',
      message: 'Detecting profanity in subtitle text...'
    });
    rawSuggestions.push(...buildProfanitySuggestions(subtitleCues, subtitleSource));
    collectedSources.push(subtitleSource);

    if (
      capabilities.whisperTinyAvailable &&
      (request.options.enhancedMode || subtitlesLookIncomplete(subtitleCues, duration))
    ) {
      emitProgress(request.onProgress, {
        phase: 'transcribe-tiny',
        message: 'Running whisper.cpp tiny refinement...'
      });

      try {
        const refinedCues = await dependencies.transcribeWithWhisper(request.inputPath, 'tiny');
        rawSuggestions.push(...buildProfanitySuggestions(refinedCues, 'whisper-tiny'));
        collectedSources.push('whisper-tiny');
        whisperRefinementApplied = true;
      } catch {
        // Refinement is best-effort when subtitle cues already exist.
      }
    }
  } else {
    if (!capabilities.whisperBaseAvailable) {
      throw new Error(
        `No usable embedded or remote subtitles were found, and whisper.cpp base fallback is not configured. ${getWhisperSetupInstructions(
          'base'
        )}`
      );
    }

    emitProgress(request.onProgress, {
      phase: 'transcribe-base',
      message: 'Running whisper.cpp base fallback...'
    });
    const transcribedCues = await dependencies.transcribeWithWhisper(request.inputPath, 'base');
    rawSuggestions.push(...buildProfanitySuggestions(transcribedCues, 'whisper-base'));
    collectedSources.push('whisper-base');
    subtitleCues = null;
    subtitleSource = null;
    remoteLookupUsed = false;
  }

  emitProgress(request.onProgress, {
    phase: 'merge-detections',
    message: 'Merging profanity detections into draft mute suggestions...'
  });
  const suggestions = mergeProfanitySuggestions(rawSuggestions, duration);
  const usedSources = uniqueSources(collectedSources);
  const message =
    suggestions.length === 0
      ? 'No profanity matches were detected.'
      : `Detected ${suggestions.length} draft mute suggestion${suggestions.length === 1 ? '' : 's'}.`;

  emitProgress(request.onProgress, {
    phase: 'done',
    message
  });

  return {
    suggestions,
    usedSources,
    subtitleCueCount: subtitleCues?.length ?? 0,
    remoteLookupUsed,
    whisperRefinementApplied,
    message
  };
}
