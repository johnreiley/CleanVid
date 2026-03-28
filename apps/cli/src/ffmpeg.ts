import { spawn } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
}

export interface ProbeFormat {
  duration?: string;
}

export interface ProbeResponse {
  streams?: ProbeStream[];
  format?: ProbeFormat;
}

export interface MediaInfo {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface FfmpegProgressEvent {
  frame?: number;
  fps?: number;
  speed?: string;
  outTimeSeconds?: number;
  progress: 'continue' | 'end';
}

export class CommandExecutionError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly stderr: string;

  constructor(command: string, args: string[], stderr: string) {
    super(`${command} failed: ${stderr || 'Unknown error'}`);
    this.name = 'CommandExecutionError';
    this.command = command;
    this.args = args;
    this.stderr = stderr;
  }
}

export async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new CommandExecutionError(command, args, stderr.trim()));
    });
  });
}

function parseTimestamp(value: string): number | undefined {
  const parts = value.split(':');

  if (parts.length !== 3) {
    return undefined;
  }

  const [hoursText, minutesText, secondsText] = parts;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);

  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return undefined;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function parseOutTimeSeconds(fields: Record<string, string>): number | undefined {
  const outTime = fields.out_time;

  if (outTime) {
    return parseTimestamp(outTime);
  }

  const outTimeUs = fields.out_time_us;

  if (outTimeUs) {
    const numeric = Number(outTimeUs);

    if (Number.isFinite(numeric)) {
      return numeric / 1_000_000;
    }
  }

  const outTimeMs = fields.out_time_ms;

  if (outTimeMs) {
    const numeric = Number(outTimeMs);

    if (Number.isFinite(numeric)) {
      return numeric / 1_000_000;
    }
  }

  return undefined;
}

function finalizeProgressFields(fields: Record<string, string>): FfmpegProgressEvent | null {
  if (fields.progress !== 'continue' && fields.progress !== 'end') {
    return null;
  }

  const frame = Number(fields.frame);
  const fps = Number(fields.fps);

  return {
    progress: fields.progress,
    frame: Number.isFinite(frame) ? frame : undefined,
    fps: Number.isFinite(fps) ? fps : undefined,
    speed: fields.speed || undefined,
    outTimeSeconds: parseOutTimeSeconds(fields)
  };
}

export function createFfmpegProgressParser(onProgress: (event: FfmpegProgressEvent) => void) {
  let buffer = '';
  let fields: Record<string, string> = {};

  const handleLine = (line: string) => {
    const trimmed = line.trim();

    if (trimmed === '') {
      return;
    }

    const delimiterIndex = trimmed.indexOf('=');

    if (delimiterIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, delimiterIndex);
    const value = trimmed.slice(delimiterIndex + 1);
    fields[key] = value;

    if (key === 'progress') {
      const event = finalizeProgressFields(fields);

      if (event) {
        onProgress(event);
      }

      fields = {};
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;

      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
        newlineIndex = buffer.indexOf('\n');
      }
    },
    flush() {
      const trailing = buffer.trim();

      if (trailing !== '') {
        handleLine(trailing);
      }
    }
  };
}

export async function runFfmpegWithProgress(
  args: string[],
  onProgress?: (event: FfmpegProgressEvent) => void
): Promise<CommandResult> {
  const ffmpegArgs = ['-progress', 'pipe:1', '-nostats', '-stats_period', '0.1', ...args];

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ffmpegArgs, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const parser = createFfmpegProgressParser((event) => {
      onProgress?.(event);
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      parser.push(text);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      parser.flush();

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new CommandExecutionError('ffmpeg', ffmpegArgs, stderr.trim()));
    });
  });
}

export async function probeMedia(inputPath: string): Promise<MediaInfo> {
  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath
  ];

  const { stdout } = await runCommand('ffprobe', args);
  const parsed = JSON.parse(stdout) as ProbeResponse;
  const duration = Number(parsed.format?.duration);
  const streams = parsed.streams ?? [];
  const hasVideo = streams.some((stream) => stream.codec_type === 'video');
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio');

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to determine media duration with ffprobe.');
  }

  return {
    duration,
    hasVideo,
    hasAudio
  };
}
