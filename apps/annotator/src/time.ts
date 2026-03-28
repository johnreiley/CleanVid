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
