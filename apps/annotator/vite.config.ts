import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import {
  FilterValidationError,
  normalizeFilters,
  serializeFilterFile,
  type FilterSegment
} from '../../packages/shared/src/index';
import { processMedia, type ProcessMediaOptions } from '../cli/src/processor';
import {
  preparePreviewPlayback,
  type PlaybackSource,
  type PreviewPreparationResult
} from '../cli/src/preview';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const execFile = promisify(execFileCallback);
const VIDEO_DIALOG_FILTER =
  'Video Files|*.mp4;*.mov;*.m4v;*.mkv;*.avi;*.wmv;*.webm;*.mpg;*.mpeg|All Files|*.*';

export interface OpenVideoResult {
  cancelled: boolean;
  inputPath?: string;
  name?: string;
  outputPath?: string;
  playbackUrl?: string;
  playbackSource?: PlaybackSource;
}

export interface ProcessRequestBody {
  filters: FilterSegment[];
  inputPath: string;
  outputPath?: string;
  movieTitle?: string;
}

export interface ProcessResult {
  outputPath: string;
  message: string;
}

interface TempFilterFile {
  filtersPath: string;
  cleanup: () => Promise<void>;
}

interface ProcessRequestDependencies {
  ensureInputExists: (inputPath: string) => Promise<void>;
  createTempFilterFile: (content: string) => Promise<TempFilterFile>;
  processMediaImpl: (options: ProcessMediaOptions) => Promise<void>;
}

interface OpenVideoDependencies {
  selectFilePath: () => Promise<string | null>;
  preparePlaybackFile: (inputPath: string) => Promise<PreviewPreparationResult>;
  registerPlaybackPath: (filePath: string) => string;
}

interface PlaybackRegistry {
  getPlaybackPath: (token: string) => string | undefined;
  registerPlaybackPath: (filePath: string) => string;
}

class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function deriveDefaultOutputPath(inputPath: string): string {
  const parsed = path.parse(path.resolve(inputPath));
  const extension = parsed.ext || '';
  const suffix = extension ? `${parsed.name}.cleaned${extension}` : `${parsed.base}.cleaned`;
  return path.join(parsed.dir, suffix);
}

async function ensureInputExists(inputPath: string) {
  try {
    await access(path.resolve(inputPath));
  } catch {
    throw new HttpError(400, 'Opened input file could not be found.');
  }
}

async function createTempFilterFile(content: string): Promise<TempFilterFile> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'cleanvid-annotator-'));
  const filtersPath = path.join(tempDirectory, 'filters.json');
  await writeFile(filtersPath, content, 'utf8');

  return {
    filtersPath,
    cleanup: async () => {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  };
}

function getDefaultProcessRequestDependencies(): ProcessRequestDependencies {
  return {
    ensureInputExists,
    createTempFilterFile,
    processMediaImpl: processMedia
  };
}

function getDefaultOpenVideoDependencies(): OpenVideoDependencies {
  return {
    selectFilePath: openNativeVideoFileDialog,
    preparePlaybackFile: preparePreviewPlayback,
    registerPlaybackPath: defaultPlaybackRegistry.registerPlaybackPath
  };
}

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

const defaultPlaybackRegistry = createPlaybackRegistry();

export async function openNativeVideoFileDialog(): Promise<string | null> {
  if (process.platform !== 'win32') {
    throw new HttpError(501, 'Native file selection is only supported on Windows in this build.');
  }

  const script = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select video file'
$dialog.Filter = '${VIDEO_DIALOG_FILTER}'
$dialog.Multiselect = $false
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.FileName) {
  Write-Output $dialog.FileName
}
`;

  const { stdout } = await execFile(
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-STA', '-EncodedCommand', encodePowerShellCommand(script)],
    {
      windowsHide: false,
      maxBuffer: 1024 * 1024
    }
  );

  const selectedPath = stdout.trim();
  return selectedPath === '' ? null : selectedPath;
}

export async function handleOpenVideoRequest(
  dependencies: OpenVideoDependencies = getDefaultOpenVideoDependencies()
): Promise<OpenVideoResult> {
  const selectedPath = await dependencies.selectFilePath();

  if (!selectedPath) {
    return { cancelled: true };
  }

  const preparedPlayback = await dependencies.preparePlaybackFile(selectedPath);

  return {
    cancelled: false,
    inputPath: preparedPlayback.inputPath,
    name: preparedPlayback.name,
    outputPath: deriveDefaultOutputPath(preparedPlayback.inputPath),
    playbackUrl: dependencies.registerPlaybackPath(preparedPlayback.playbackPath),
    playbackSource: preparedPlayback.playbackSource
  };
}

export function createPlaybackRegistry(): PlaybackRegistry {
  const registry = new Map<string, string>();

  return {
    getPlaybackPath(token: string) {
      return registry.get(token);
    },
    registerPlaybackPath(filePath: string) {
      const token = randomUUID();
      registry.set(token, path.resolve(filePath));
      return `/api/media/${token}`;
    }
  };
}

function getMediaContentType(filePath: string): string {
  return MEDIA_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

interface ByteRange {
  start: number;
  end: number;
}

export function resolveByteRange(rangeHeader: string, fileSize: number): ByteRange | null {
  const matches = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!matches) {
    return null;
  }

  const [, startText, endText] = matches;

  if (startText === '' && endText === '') {
    return null;
  }

  if (startText === '') {
    const suffixLength = Number(endText);

    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    return {
      start: Math.max(fileSize - suffixLength, 0),
      end: fileSize - 1
    };
  }

  const start = Number(startText);
  const parsedEnd = endText === '' ? fileSize - 1 : Number(endText);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(parsedEnd) ||
    start < 0 ||
    parsedEnd < start ||
    start >= fileSize
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(parsedEnd, fileSize - 1)
  };
}

export async function handleMediaRequest(
  request: IncomingMessage,
  response: ServerResponse,
  playbackRegistry: PlaybackRegistry = defaultPlaybackRegistry
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const mediaPrefix = '/api/media/';

  if (!url.pathname.startsWith(mediaPrefix)) {
    return false;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { message: 'Method not allowed.' });
    return true;
  }

  const token = decodeURIComponent(url.pathname.slice(mediaPrefix.length));
  const playbackPath = playbackRegistry.getPlaybackPath(token);

  if (!playbackPath) {
    throw new HttpError(404, 'Playback file not found.');
  }

  let fileStats;

  try {
    fileStats = await stat(playbackPath);
  } catch {
    throw new HttpError(404, 'Playback file not found.');
  }

  const fileSize = fileStats.size;
  const rangeHeader = request.headers.range;
  const resolvedRange =
    typeof rangeHeader === 'string' ? resolveByteRange(rangeHeader, fileSize) : null;

  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', getMediaContentType(playbackPath));

  if (typeof rangeHeader === 'string' && !resolvedRange) {
    response.statusCode = 416;
    response.setHeader('Content-Range', `bytes */${fileSize}`);
    response.end();
    return true;
  }

  if (!resolvedRange) {
    response.statusCode = 200;
    response.setHeader('Content-Length', fileSize);

    if (request.method === 'HEAD') {
      response.end();
      return true;
    }

    await pipeFileToResponse(response, playbackPath);
    return true;
  }

  response.statusCode = 206;
  response.setHeader('Content-Length', resolvedRange.end - resolvedRange.start + 1);
  response.setHeader(
    'Content-Range',
    `bytes ${resolvedRange.start}-${resolvedRange.end}/${fileSize}`
  );

  if (request.method === 'HEAD') {
    response.end();
    return true;
  }

  await pipeFileToResponse(response, playbackPath, resolvedRange);
  return true;
}

function parseProcessRequestBody(body: unknown): Required<ProcessRequestBody> {
  if (typeof body !== 'object' || body === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }

  const record = body as Record<string, unknown>;
  const inputPath = typeof record.inputPath === 'string' ? record.inputPath.trim() : '';
  const outputPath = typeof record.outputPath === 'string' ? record.outputPath.trim() : '';
  const movieTitle = typeof record.movieTitle === 'string' ? record.movieTitle.trim() : '';

  if (inputPath === '') {
    throw new HttpError(400, 'inputPath is required.');
  }

  if (!Array.isArray(record.filters)) {
    throw new HttpError(400, 'filters must be an array.');
  }

  try {
    return {
      inputPath,
      outputPath,
      movieTitle,
      filters: normalizeFilters(record.filters as FilterSegment[])
    };
  } catch (error) {
    if (error instanceof FilterValidationError) {
      throw new HttpError(400, error.message);
    }

    throw error;
  }
}

export async function handleProcessRequest(
  body: unknown,
  dependencies: ProcessRequestDependencies = getDefaultProcessRequestDependencies()
): Promise<ProcessResult> {
  const request = parseProcessRequestBody(body);
  const resolvedInputPath = path.resolve(request.inputPath);
  const resolvedOutputPath =
    request.outputPath === '' ? deriveDefaultOutputPath(resolvedInputPath) : path.resolve(request.outputPath);

  await dependencies.ensureInputExists(resolvedInputPath);

  if (resolvedInputPath === resolvedOutputPath) {
    throw new HttpError(400, 'Output path must be different from the linked input file.');
  }

  const filterFileContent = serializeFilterFile({
    version: 1,
    movie: {
      title: request.movieTitle || path.parse(resolvedInputPath).name,
      duration: 0
    },
    filters: request.filters
  });
  const tempFilterFile = await dependencies.createTempFilterFile(filterFileContent);

  try {
    await dependencies.processMediaImpl({
      inputPath: resolvedInputPath,
      filtersPath: tempFilterFile.filtersPath,
      outputPath: resolvedOutputPath
    });
  } finally {
    await tempFilterFile.cleanup();
  }

  return {
    outputPath: resolvedOutputPath,
    message: `Processed video to ${resolvedOutputPath}.`
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HttpError(400, `Invalid JSON request body: ${error.message}`);
    }

    throw error;
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

async function pipeFileToResponse(
  response: ServerResponse,
  filePath: string,
  options?: { start?: number; end?: number }
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, options);
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      response.off('close', finish);
      response.off('finish', finish);
      resolve();
    };

    const fail = (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      response.off('close', finish);
      response.off('finish', finish);
      reject(error);
    };

    stream.on('error', fail);
    response.on('close', finish);
    response.on('finish', finish);
    stream.pipe(response);
  });
}

async function handleApiRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (await handleMediaRequest(request, response)) {
    return true;
  }

  if (url.pathname === '/api/open-video') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { message: 'Method not allowed.' });
      return true;
    }

    const result = await handleOpenVideoRequest();
    sendJson(response, 200, result);
    return true;
  }

  if (url.pathname === '/api/process') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { message: 'Method not allowed.' });
      return true;
    }

    const body = await readJsonBody(request);
    const result = await handleProcessRequest(body);
    sendJson(response, 200, result);
    return true;
  }

  return false;
}

function createAnnotatorApiPlugin(): Plugin {
  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void
  ) => {
    try {
      const handled = await handleApiRequest(request, response);

      if (!handled) {
        next();
      }
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, { message: error.message });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unexpected server error.';
      sendJson(response, 500, { message });
    }
  };

  return {
    name: 'cleanvid-annotator-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

export default defineConfig({
  plugins: [vue(), createAnnotatorApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@cleanvid/shared': path.resolve(rootDir, '../../packages/shared/src/index.ts'),
      '@phosphor-icons-vue-icons': path.resolve(
        rootDir,
        '../../node_modules/@phosphor-icons/vue/dist/icons'
      )
    }
  }
});
