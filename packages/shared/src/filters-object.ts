import { FilterValidationError } from './errors.js';
import type {
  FilterType,
  FiltersObjectCategory,
  FiltersObjectParseResult,
  FiltersObjectSourceType,
  FiltersObjectTag
} from './types.js';

const DEFAULT_POINT_TAG_DURATION_SECONDS = 0.5;

interface ParseContext {
  duration?: number;
  pointTagDurationSeconds: number;
  tags: FiltersObjectTag[];
  skippedTagCount: number;
  warnings: string[];
}

export interface ParseFiltersObjectFileOptions {
  duration?: number;
  pointTagDurationSeconds?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  return null;
}

function readRequiredString(value: unknown): string | null {
  const text = readNullableString(value);
  return text === null || text.trim() === '' ? null : text.trim();
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapSourceType(value: unknown): { sourceType: FiltersObjectSourceType; type: FilterType } | null {
  if (value === 'audio') {
    return { sourceType: 'audio', type: 'mute' };
  }

  if (value === 'audiovisual') {
    return { sourceType: 'audiovisual', type: 'skip' };
  }

  return null;
}

function clampRange(start: number, end: number, duration?: number): { start: number; end: number } | null {
  if (duration === undefined) {
    return start < end ? { start: Math.max(0, start), end: Math.max(0, end) } : null;
  }

  const clampedStart = Math.max(0, Math.min(start, duration));
  const clampedEnd = Math.max(0, Math.min(end, duration));

  return clampedStart < clampedEnd ? { start: clampedStart, end: clampedEnd } : null;
}

function buildPointRange(
  timestamp: number,
  duration: number | undefined,
  pointTagDurationSeconds: number
): { start: number; end: number } | null {
  if (duration !== undefined && duration <= 0) {
    return null;
  }

  const safeDuration = Math.max(0.001, pointTagDurationSeconds);
  let start = timestamp - safeDuration / 2;
  let end = timestamp + safeDuration / 2;

  if (duration !== undefined) {
    if (end > duration) {
      start -= end - duration;
      end = duration;
    }

    if (start < 0) {
      end += -start;
      start = 0;
    }

    end = Math.min(end, duration);
  }

  return clampRange(start, end, duration);
}

function parseTag(
  rawTag: unknown,
  categoryPath: string[],
  context: ParseContext,
  tagIndex: number
): FiltersObjectTag | null {
  if (!isRecord(rawTag)) {
    context.skippedTagCount += 1;
    context.warnings.push(`Skipped tag ${tagIndex + 1} in ${categoryPath.join(' > ')}: tag must be an object.`);
    return null;
  }

  const sourceId = readRequiredString(rawTag.id);
  const typeMapping = mapSourceType(rawTag.type);
  const startApprox = readFiniteNumber(rawTag.start_approx);
  const endApprox = readFiniteNumber(rawTag.end_approx);

  if (!sourceId) {
    context.skippedTagCount += 1;
    context.warnings.push(`Skipped tag ${tagIndex + 1} in ${categoryPath.join(' > ')}: missing tag id.`);
    return null;
  }

  if (!typeMapping) {
    context.skippedTagCount += 1;
    context.warnings.push(`Skipped tag ${sourceId}: unsupported type "${String(rawTag.type)}".`);
    return null;
  }

  if (startApprox === null || endApprox === null) {
    context.skippedTagCount += 1;
    context.warnings.push(`Skipped tag ${sourceId}: start_approx and end_approx must be finite numbers.`);
    return null;
  }

  const range =
    startApprox === endApprox
      ? buildPointRange(startApprox, context.duration, context.pointTagDurationSeconds)
      : clampRange(Math.min(startApprox, endApprox), Math.max(startApprox, endApprox), context.duration);

  if (!range) {
    context.skippedTagCount += 1;
    context.warnings.push(`Skipped tag ${sourceId}: time range is outside the loaded movie duration.`);
    return null;
  }

  const tag: FiltersObjectTag = {
    id: `filters-object-${sourceId}`,
    sourceId,
    refId: readNullableString(rawTag.ref_id),
    tagSetId: readNullableString(rawTag.tag_set_id),
    categoryId: readNullableString(rawTag.category_id),
    description: readRequiredString(rawTag.description) ?? categoryPath[categoryPath.length - 1] ?? 'Untitled tag',
    locked: rawTag.locked === true,
    categoryPath,
    ...typeMapping,
    start: range.start,
    end: range.end
  };

  context.tags.push(tag);
  return tag;
}

function parseCategory(rawCategory: unknown, path: string[], context: ParseContext, index: number): FiltersObjectCategory {
  if (!isRecord(rawCategory)) {
    throw new FilterValidationError(`Category ${index + 1} must be an object.`);
  }

  const id = readRequiredString(rawCategory.id);
  const title = readRequiredString(rawCategory.display_title);

  if (!id) {
    throw new FilterValidationError(`Category ${index + 1} is missing id.`);
  }

  if (!title) {
    throw new FilterValidationError(`Category ${id} is missing display_title.`);
  }

  const categoryPath = [...path, title];
  const rawTags = Array.isArray(rawCategory.tags) ? rawCategory.tags : [];
  const rawChildren = Array.isArray(rawCategory.child_categories) ? rawCategory.child_categories : [];

  return {
    id,
    key: readRequiredString(rawCategory.key) ?? id,
    title,
    defaultType: readNullableString(rawCategory.default_type),
    parentId: readNullableString(rawCategory.parent_id),
    iconUrl: readNullableString(rawCategory.icon_url),
    whiteIconUrl: readNullableString(rawCategory.white_icon_url),
    locked: rawCategory.locked === true,
    tags: rawTags
      .map((rawTag, tagIndex) => parseTag(rawTag, categoryPath, context, tagIndex))
      .filter((tag): tag is FiltersObjectTag => tag !== null),
    childCategories: rawChildren.map((child, childIndex) =>
      parseCategory(child, categoryPath, context, childIndex)
    )
  };
}

export function parseFiltersObjectFile(
  input: string | unknown,
  options: ParseFiltersObjectFileOptions = {}
): FiltersObjectParseResult {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;

  if (!Array.isArray(parsed)) {
    throw new FilterValidationError('Filters-object files must be a JSON array of categories.');
  }

  const duration = options.duration;

  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
    throw new FilterValidationError('Filters-object imports require a loaded movie duration greater than zero.');
  }

  const pointTagDurationSeconds =
    options.pointTagDurationSeconds ?? DEFAULT_POINT_TAG_DURATION_SECONDS;

  const context: ParseContext = {
    duration,
    pointTagDurationSeconds,
    tags: [],
    skippedTagCount: 0,
    warnings: []
  };
  const categories = parsed.map((category, index) => parseCategory(category, [], context, index));

  if (context.tags.length === 0) {
    throw new FilterValidationError(
      context.warnings[0] ?? 'No usable filters-object tags were found in the selected file.'
    );
  }

  return {
    categories,
    tags: context.tags,
    skippedTagCount: context.skippedTagCount,
    warnings: context.warnings
  };
}
