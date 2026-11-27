import path from 'node:path';
import type { TimedTranscriptSegment } from '@cleanvid/shared';

type ReadField<T> = (value: unknown, field: string) => T;

function invalid(field: string, reason: string): never {
  throw new Error(`Invalid MTS transcript at ${field}: ${reason}.`);
}

function object<T>(shape: { [K in keyof T]: ReadField<T[K]> }): ReadField<T> {
  return (value, field) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      invalid(field, 'expected an object');
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(shape, key)) {
        invalid(`${field}.${key}`, 'unexpected field');
      }
    }
    const result = {} as T;
    for (const key in shape) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        invalid(`${field}.${key}`, 'required field is missing');
      }
      result[key] = shape[key](record[key], `${field}.${key}`);
    }
    return result;
  };
}

function array<T>(read: ReadField<T>): ReadField<T[]> {
  return (value, field) => {
    if (!Array.isArray(value)) {
      invalid(field, 'expected an array');
    }
    return value.map((item, index) => read(item, `${field}[${index}]`));
  };
}

const string: ReadField<string> = (value, field) =>
  typeof value === 'string' ? value : invalid(field, 'expected a string');

function integer(minimum = 0): ReadField<number> {
  return (value, field) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
    ? value
    : invalid(field, `expected an integer of at least ${minimum} within the safe integer range`);
}

function literal<const T extends string | number>(expected: T): ReadField<T> {
  return (value, field) => value === expected ? expected : invalid(field, `expected ${JSON.stringify(expected)}`);
}

function pattern(expected: RegExp, description: string): ReadField<string> {
  return (value, field) => typeof value === 'string' && expected.test(value)
    ? value
    : invalid(field, `expected ${description}`);
}

const uuid = pattern(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, 'a UUID');
const probability: ReadField<number | null> = (value, field) =>
  value === null || (typeof value === 'number' && value >= 0 && value <= 1)
    ? value
    : invalid(field, 'expected null or a number between 0 and 1');

const timedFields = { id: string, startMs: integer(), endMs: integer(), text: string };

function timed<T extends { startMs: number; endMs: number }>(read: ReadField<T>): ReadField<T> {
  return (value, field) => {
    const result = read(value, field);
    if (result.endMs < result.startMs) {
      invalid(`${field}.endMs`, 'cannot precede startMs');
    }
    return result;
  };
}

const readTranscript = object({
  schemaVersion: literal(1),
  mediaId: uuid,
  mediaVersionId: uuid,
  jobId: uuid,
  source: object({
    fileName: string,
    sizeBytes: integer(),
    durationMs: integer(),
    playbackOrigin: literal('normalized-container-presentation-time'),
    audioStreamIndex: integer(),
    language: literal('en'),
    channels: integer(1)
  }),
  engine: object({
    name: literal('faster-whisper'),
    version: string,
    model: string,
    modelRevision: string,
    profileHash: pattern(/^[0-9a-f]{64}$/, '64 lowercase hexadecimal characters'),
    computeType: literal('int8'),
    wordTimestampMethod: literal('engine-native')
  }),
  coverage: object({
    expectedChunks: integer(),
    completedChunks: integer(),
    audioDurationMs: integer(),
    warnings: array(string)
  }),
  segments: array(timed(object({
    ...timedFields,
    words: array(timed(object({ ...timedFields, probability })))
  })))
});

export type MtsTranscript = ReturnType<typeof readTranscript>;

export function parseMtsTranscript(text: string): MtsTranscript {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Could not read the MTS transcript: invalid JSON.');
  }
  if (typeof value === 'object' && value !== null && 'schemaVersion' in value && value.schemaVersion !== 1) {
    throw new Error('Unsupported MTS transcript schemaVersion. Export a version 1 transcript and try again.');
  }
  return readTranscript(value, '$');
}

const DURATION_TOLERANCE_MS = 1000;

export function checkMtsTranscriptMedia(
  transcript: MtsTranscript,
  media: { inputPath: string; duration: number; sizeBytes?: number; firstAudioStreamIndex?: number }
): string[] {
  const { source, coverage } = transcript;
  const durationMs = media.duration * 1000;
  if (Math.abs(source.durationMs - durationMs) > DURATION_TOLERANCE_MS) {
    throw new Error('The MTS transcript duration does not match the opened video. Choose a transcript for the original video.');
  }
  if (media.firstAudioStreamIndex === undefined || source.audioStreamIndex !== media.firstAudioStreamIndex) {
    throw new Error('The MTS transcript audio stream does not match the first audio track CleanVid exports. Choose a transcript for that track.');
  }

  const warnings: string[] = [];
  const fileNamesDiffer = path.win32.basename(source.fileName).toLowerCase() !== path.win32.basename(media.inputPath).toLowerCase();
  if (fileNamesDiffer || (media.sizeBytes !== undefined && source.sizeBytes !== media.sizeBytes)) {
    warnings.push('The transcript source filename or file size differs from the opened video. Check that the draft ranges line up before applying them.');
  }
  if (coverage.completedChunks < coverage.expectedChunks) {
    warnings.push(`Transcript coverage is incomplete (${coverage.completedChunks} of ${coverage.expectedChunks} chunks). Profanity may be missing from the results.`);
  }
  warnings.push(...coverage.warnings.map((warning) => warning.trim()).filter(Boolean));

  let lastEndMs = 0;
  for (const segment of transcript.segments) {
    lastEndMs = Math.max(lastEndMs, segment.endMs);
    for (const word of segment.words) {
      lastEndMs = Math.max(lastEndMs, word.endMs);
    }
  }
  if (lastEndMs > Math.min(source.durationMs, durationMs) + DURATION_TOLERANCE_MS) {
    throw new Error('The MTS transcript contains timestamps beyond the end of the video. Check that the transcript matches the opened video.');
  }
  if (lastEndMs > durationMs) {
    warnings.push('Some transcript timestamps extend past the video. Draft mute ranges are limited to the playable duration.');
  }
  return warnings;
}

export function toTimedTranscriptSegments(transcript: MtsTranscript): TimedTranscriptSegment[] {
  function toCue({ id, startMs, endMs, text }: { id: string; startMs: number; endMs: number; text: string }) {
    return { id, start: startMs / 1000, end: endMs / 1000, text };
  }
  return transcript.segments.map((segment) => ({
    ...toCue(segment),
    words: segment.words.map((word) => ({ ...toCue(word), probability: word.probability }))
  }));
}
