export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00.000';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
  const base = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis
    .toString()
    .padStart(3, '0')}`;

  if (hours === 0) {
    return base;
  }

  return `${hours.toString().padStart(2, '0')}:${base}`;
}

export function parseTimestamp(value: string): number | null {
  const input = value.trim();

  if (!input) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(input)) {
    const seconds = Number(input);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  const parts = input.split(':');

  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const secondsPart = parts[parts.length - 1] ?? '';
  const minutesPart = parts[parts.length - 2] ?? '';
  const hoursPart = parts.length === 3 ? parts[0] ?? '' : '0';
  const secondsMatch = secondsPart.match(/^(\d{1,2})(?:\.(\d{1,3}))?$/);

  if (!secondsMatch || !/^\d+$/.test(minutesPart) || !/^\d+$/.test(hoursPart)) {
    return null;
  }

  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(secondsMatch[1]);
  const milliseconds = Number((secondsMatch[2] ?? '').padEnd(3, '0'));

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(milliseconds) ||
    minutes < 0 ||
    seconds < 0 ||
    seconds >= 60 ||
    milliseconds < 0 ||
    milliseconds >= 1000
  ) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}
