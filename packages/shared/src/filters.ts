import { FilterValidationError } from './errors.js';
import type { FilterFile, FilterSegment, FilterType, MovieMetadata } from './types.js';

const ALLOWED_TYPES = new Set<FilterType>(['mute', 'skip']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FilterValidationError(`${fieldName} must be a finite number.`);
  }

  return value;
}

function validateSegment(rawSegment: unknown, index: number): FilterSegment {
  if (!isRecord(rawSegment)) {
    throw new FilterValidationError(`filters[${index}] must be an object.`);
  }

  const { id, type, start, end } = rawSegment;

  if (typeof id !== 'string' || id.trim() === '') {
    throw new FilterValidationError(`filters[${index}].id must be a non-empty string.`);
  }

  if (typeof type !== 'string' || !ALLOWED_TYPES.has(type as FilterType)) {
    throw new FilterValidationError(`filters[${index}].type must be "mute" or "skip".`);
  }

  const numericStart = asFiniteNumber(start, `filters[${index}].start`);
  const numericEnd = asFiniteNumber(end, `filters[${index}].end`);

  if (numericStart >= numericEnd) {
    throw new FilterValidationError(`filters[${index}] must satisfy start < end.`);
  }

  return {
    id,
    type: type as FilterType,
    start: numericStart,
    end: numericEnd
  };
}

export function validateMovieMetadata(rawMovie: unknown): MovieMetadata {
  if (!isRecord(rawMovie)) {
    throw new FilterValidationError('movie must be an object.');
  }

  const duration = asFiniteNumber(rawMovie.duration, 'movie.duration');

  if (duration < 0) {
    throw new FilterValidationError('movie.duration must be zero or greater.');
  }

  const title = rawMovie.title;

  if (title !== undefined && typeof title !== 'string') {
    throw new FilterValidationError('movie.title must be a string when provided.');
  }

  return title ? { title, duration } : { duration };
}

export interface NormalizeOptions {
  duration?: number;
}

function compareSegments(left: FilterSegment, right: FilterSegment): number {
  return (
    left.start - right.start ||
    left.end - right.end ||
    left.type.localeCompare(right.type) ||
    left.id.localeCompare(right.id)
  );
}

export function normalizeFilters(filters: FilterSegment[], options: NormalizeOptions = {}): FilterSegment[] {
  const seenIds = new Set<string>();
  const duration = options.duration;

  if (duration !== undefined) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new FilterValidationError('duration must be a finite number greater than or equal to zero.');
    }
  }

  const normalized = filters.map((segment, index) => {
    const validated = validateSegment(segment, index);

    if (seenIds.has(validated.id)) {
      throw new FilterValidationError(`Duplicate filter id "${validated.id}" is not allowed.`);
    }

    seenIds.add(validated.id);

    if (duration === undefined) {
      return validated;
    }

    const start = Math.max(0, Math.min(validated.start, duration));
    const end = Math.max(0, Math.min(validated.end, duration));

    if (start >= end) {
      return null;
    }

    return {
      ...validated,
      start,
      end
    };
  });

  return normalized
    .filter((segment): segment is FilterSegment => segment !== null)
    .sort(compareSegments);
}

export function parseFilterFile(input: string | unknown): FilterFile {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;

  if (!isRecord(parsed)) {
    throw new FilterValidationError('Filter file must be a JSON object.');
  }

  if (parsed.version !== 1) {
    throw new FilterValidationError('Only filter file version 1 is supported.');
  }

  if (!Array.isArray(parsed.filters)) {
    throw new FilterValidationError('filters must be an array.');
  }

  return {
    version: 1,
    movie: validateMovieMetadata(parsed.movie),
    filters: normalizeFilters(parsed.filters as FilterSegment[])
  };
}

export function serializeFilterFile(filterFile: FilterFile): string {
  const movie = validateMovieMetadata(filterFile.movie);
  const filters = normalizeFilters(filterFile.filters);

  return `${JSON.stringify({ version: 1, movie, filters }, null, 2)}\n`;
}
