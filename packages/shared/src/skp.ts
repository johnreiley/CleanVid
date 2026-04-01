import { FilterValidationError } from './errors.js';
import type { FilterType } from './types.js';

export type SkpCategory =
  | 'sex'
  | 'nude'
  | 'violence'
  | 'gore'
  | 'drugs'
  | 'profanity'
  | 'audio'
  | 'other';
export type SkpSeverity = 1 | 2 | 3;

export interface SkpDraftSegment {
  id: string;
  type: FilterType;
  start: number;
  end: number;
  category: SkpCategory;
  severity: SkpSeverity;
  description: string;
}

export interface SkpParseResult {
  segments: SkpDraftSegment[];
  skippedEntryCount: number;
  warnings: string[];
}

const TIME_PART_PATTERN = '(\\d{1,2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?)';
const TIME_RANGE_PATTERN = new RegExp(
  `^${TIME_PART_PATTERN}\\s*(?:-|-->)\\s*${TIME_PART_PATTERN}$`
);
const LABEL_WITH_ACTION_PATTERN = /^(.*?)\s+(mute|skip)\s+([1-3])(?:\s*\((.+)\))?$/i;
const LABEL_WITHOUT_ACTION_PATTERN = /^(.*?)\s+([1-3])(?:\s*\((.+)\))?$/i;

function stripDisabledPrefix(value: string): string {
  return value.replace(/^\/\//, '').trim();
}

function parseSkpTimestamp(rawValue: string): number | null {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(rawValue.trim());

  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds, fraction = '0'] = match;
  const fractionalSeconds = Number(`0.${fraction}`);

  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    fractionalSeconds
  );
}

function parseTimeRange(line: string): { start: number; end: number } | null {
  const match = TIME_RANGE_PATTERN.exec(line.trim());

  if (!match) {
    return null;
  }

  const start = parseSkpTimestamp(match[1]);
  const end = parseSkpTimestamp(match[2]);

  if (start === null || end === null || start >= end) {
    return null;
  }

  return { start, end };
}

function isTimeRangeLine(line: string): boolean {
  return TIME_RANGE_PATTERN.test(line.trim());
}

function normalizeSkpCategory(description: string): SkpCategory {
  const normalized = description.toLowerCase();

  if (/\b(audio|sound|lyrics?|song|music|moaning|scream(?:ing)?|sfx)\b/.test(normalized)) {
    return 'audio';
  }

  if (/\b(gore|gory|blood(?:y)?|dismember(?:ment|ed)?|disembowel(?:ed|ment)?)\b/.test(normalized)) {
    return 'gore';
  }

  if (/\b(violence|violent|fight(?:ing)?|assault|attack(?:ed|ing)?)\b/.test(normalized)) {
    return 'violence';
  }

  if (/\b(nudity|nude|nudity\/sexual|topless|naked)\b/.test(normalized)) {
    return 'nude';
  }

  if (/\b(sex|sexual|intercourse|sexual content|sexuality)\b/.test(normalized)) {
    return 'sex';
  }

  if (/\b(drug|drugs|drug use|smoking|weed|cocaine|heroin|meth)\b/.test(normalized)) {
    return 'drugs';
  }

  if (/\b(profanity|profane|language|swearing|swear(?:ing)?|curse(?:d|s)?|cursing)\b/.test(normalized)) {
    return 'profanity';
  }

  return 'other';
}

function mapSkpCategoryToFilterType(category: SkpCategory): FilterType {
  return category === 'audio' || category === 'profanity' ? 'mute' : 'skip';
}

function buildParsedLabel(
  rawCategoryText: string,
  rawSeverity: string,
  rawDetails?: string
): Pick<SkpDraftSegment, 'type' | 'severity' | 'description' | 'category'> | null {
  const categoryText = rawCategoryText.trim();
  const details = rawDetails?.trim() ?? '';

  if (categoryText === '') {
    return null;
  }

  const category = normalizeSkpCategory(categoryText);

  return {
    type: mapSkpCategoryToFilterType(category),
    severity: Number(rawSeverity) as SkpSeverity,
    description: details === '' ? categoryText : details,
    category
  };
}

function parseLabelLine(
  line: string
): Pick<SkpDraftSegment, 'type' | 'severity' | 'description' | 'category'> | null {
  const withActionMatch = LABEL_WITH_ACTION_PATTERN.exec(line.trim());

  if (withActionMatch) {
    const [, rawCategoryText, , rawSeverity, rawDetails] = withActionMatch;
    return buildParsedLabel(rawCategoryText, rawSeverity, rawDetails);
  }

  const withoutActionMatch = LABEL_WITHOUT_ACTION_PATTERN.exec(line.trim());

  if (!withoutActionMatch) {
    return null;
  }

  const [, rawCategoryText, rawSeverity, rawDetails] = withoutActionMatch;
  return buildParsedLabel(rawCategoryText, rawSeverity, rawDetails);
}

export function parseSkpFile(input: string): SkpParseResult {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const segments: SkpDraftSegment[] = [];
  const warnings: string[] = [];
  let skippedEntryCount = 0;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex] ?? '';
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      lineIndex += 1;
      continue;
    }

    const disabledCandidate = stripDisabledPrefix(trimmed);

    if (trimmed.startsWith('//') && isTimeRangeLine(disabledCandidate)) {
      lineIndex += 1;

      while (lineIndex < lines.length && (lines[lineIndex] ?? '').trim() === '') {
        lineIndex += 1;
      }

      if (lineIndex < lines.length && (lines[lineIndex] ?? '').trim().startsWith('//')) {
        lineIndex += 1;
      }

      continue;
    }

    const timeRange = parseTimeRange(trimmed);

    if (!timeRange) {
      lineIndex += 1;
      continue;
    }

    let labelIndex = lineIndex + 1;

    while (labelIndex < lines.length && (lines[labelIndex] ?? '').trim() === '') {
      labelIndex += 1;
    }

    if (labelIndex >= lines.length) {
      skippedEntryCount += 1;
      warnings.push(`Skipped SKP entry starting on line ${lineIndex + 1}: missing label line.`);
      break;
    }

    const labelLine = (lines[labelIndex] ?? '').trim();

    if (labelLine.startsWith('//') && isTimeRangeLine(stripDisabledPrefix(labelLine))) {
      skippedEntryCount += 1;
      warnings.push(
        `Skipped SKP entry starting on line ${lineIndex + 1}: missing label before the next time range.`
      );
      lineIndex = labelIndex;
      continue;
    }

    if (labelLine.startsWith('//')) {
      skippedEntryCount += 1;
      warnings.push(`Skipped SKP entry starting on line ${lineIndex + 1}: label line is disabled.`);
      lineIndex = labelIndex + 1;
      continue;
    }

    if (isTimeRangeLine(labelLine)) {
      skippedEntryCount += 1;
      warnings.push(
        `Skipped SKP entry starting on line ${lineIndex + 1}: missing label before the next time range.`
      );
      lineIndex = labelIndex;
      continue;
    }

    const parsedLabel = parseLabelLine(labelLine);

    if (!parsedLabel) {
      skippedEntryCount += 1;
      warnings.push(
        `Skipped SKP entry starting on line ${lineIndex + 1}: label must include severity 1-3 and may optionally include mute/skip.`
      );
      lineIndex = labelIndex + 1;
      continue;
    }

    segments.push({
      id: `skp-${segments.length + 1}`,
      start: timeRange.start,
      end: timeRange.end,
      ...parsedLabel
    });

    lineIndex = labelIndex + 1;

    while (lineIndex < lines.length) {
      const nextLine = (lines[lineIndex] ?? '').trim();

      if (nextLine === '') {
        lineIndex += 1;
        continue;
      }

      if (isTimeRangeLine(nextLine) || (nextLine.startsWith('//') && isTimeRangeLine(stripDisabledPrefix(nextLine)))) {
        break;
      }

      lineIndex += 1;
    }
  }

  if (segments.length === 0) {
    throw new FilterValidationError(
      warnings[0] ??
        'No valid SKP entries were found. Check that the file uses supported time ranges and labels with severity 1-3.'
    );
  }

  return {
    segments,
    skippedEntryCount,
    warnings
  };
}
