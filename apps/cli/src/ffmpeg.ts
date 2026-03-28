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
