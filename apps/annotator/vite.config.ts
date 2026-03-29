import { promisify } from 'node:util';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const execFile = promisify(execFileCallback);
const VIDEO_DIALOG_FILTER =
  'Video Files|*.mp4;*.mov;*.m4v;*.mkv;*.avi;*.wmv;*.webm;*.mpg;*.mpeg|All Files|*.*';

export interface SelectFileResult {
  cancelled: boolean;
  path?: string;
  name?: string;
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

interface SelectFileDependencies {
  selectFilePath: () => Promise<string | null>;
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
    throw new HttpError(400, 'Linked input file could not be found.');
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

function getDefaultSelectFileDependencies(): SelectFileDependencies {
  return {
    selectFilePath: openNativeVideoFileDialog
  };
}

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

export async function handleSelectFileRequest(
  dependencies: SelectFileDependencies = getDefaultSelectFileDependencies()
): Promise<SelectFileResult> {
  const selectedPath = await dependencies.selectFilePath();

  if (!selectedPath) {
    return { cancelled: true };
  }

  return {
    cancelled: false,
    path: path.resolve(selectedPath),
    name: path.basename(selectedPath)
  };
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

async function handleApiRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://localhost');

  if (url.pathname === '/api/select-file') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { message: 'Method not allowed.' });
      return true;
    }

    const result = await handleSelectFileRequest();
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
