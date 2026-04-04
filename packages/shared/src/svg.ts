import { FilterValidationError } from './errors.js';
import type { FilterType } from './types.js';

export interface SvgRectImportSegment {
  type: FilterType;
  start: number;
  end: number;
}

export interface ParseSvgRectImportOptions {
  duration: number;
  type: FilterType;
}

const SVG_ROOT_PATTERN = /^\s*<svg\b[\s\S]*<\/svg>\s*$/i;
const RECT_TAG_PATTERN = /<rect\b[^>]*>/gi;
const ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
const PERCENTAGE_PATTERN = /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*%\s*$/;

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
    const [, attributeName, , doubleQuotedValue, singleQuotedValue] = match;
    attributes[attributeName.toLowerCase()] = doubleQuotedValue ?? singleQuotedValue ?? '';
  }

  return attributes;
}

function parsePercentageValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(PERCENTAGE_PATTERN);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

function clampToRange(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function parseSvgRectImport(
  input: string,
  options: ParseSvgRectImportOptions
): SvgRectImportSegment[] {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new FilterValidationError('Paste an SVG document before importing.');
  }

  if (!Number.isFinite(options.duration) || options.duration <= 0) {
    throw new FilterValidationError('SVG imports require a loaded video duration greater than zero.');
  }

  if (!SVG_ROOT_PATTERN.test(input)) {
    throw new FilterValidationError('Paste a valid SVG document.');
  }

  const parsedSegments: SvgRectImportSegment[] = [];

  for (const rectMatch of input.matchAll(RECT_TAG_PATTERN)) {
    const attributes = parseAttributes(rectMatch[0]);
    const classTokens = (attributes.class ?? '')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (!classTokens.includes('cuts')) {
      continue;
    }

    const startPercent = parsePercentageValue(attributes.x);
    const widthPercent = parsePercentageValue(attributes.width);

    if (startPercent === null || widthPercent === null) {
      continue;
    }

    const start = clampToRange((options.duration * startPercent) / 100, 0, options.duration);
    const end = clampToRange((options.duration * (startPercent + widthPercent)) / 100, 0, options.duration);

    if (end <= start) {
      continue;
    }

    parsedSegments.push({
      type: options.type,
      start,
      end
    });
  }

  if (parsedSegments.length === 0) {
    throw new FilterValidationError('The pasted SVG did not contain any usable cuts rects.');
  }

  const sortedSegments = parsedSegments.sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const mergedSegments: SvgRectImportSegment[] = [];

  for (const segment of sortedSegments) {
    const previousSegment = mergedSegments[mergedSegments.length - 1];

    if (!previousSegment || segment.start > previousSegment.end) {
      mergedSegments.push({ ...segment });
      continue;
    }

    previousSegment.end = Math.max(previousSegment.end, segment.end);
  }

  return mergedSegments;
}
