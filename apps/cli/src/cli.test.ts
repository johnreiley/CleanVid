import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildFilterGraph, processMedia } from './processor.js';
import { probeMedia, runCommand } from './ffmpeg.js';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cleanvid-'));
  tempDirs.push(directory);
  return directory;
}

async function createFixtureVideo(outputPath: string): Promise<void> {
  await runCommand('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=160x90:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000',
    '-t',
    '4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    outputPath
  ]);
}

function createFilterFile(duration: number, filters: unknown[]): string {
  return JSON.stringify(
    {
      version: 1,
      movie: { duration },
      filters
    },
    null,
    2
  );
}

async function detectSilence(inputPath: string): Promise<string> {
  const nullSink = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const { stderr } = await runCommand('ffmpeg', [
    '-hide_banner',
    '-i',
    inputPath,
    '-af',
    'silencedetect=noise=-45dB:d=0.2',
    '-f',
    'null',
    nullSink
  ]);

  return stderr;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');

  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true
      })
    )
  );
});

describe('filter graph generation', () => {
  it('builds a concat graph with conditional mute filters', () => {
    const graph = buildFilterGraph([
      {
        start: 0,
        end: 10,
        muteRanges: [{ start: 2, end: 4 }]
      },
      {
        start: 12,
        end: 15,
        muteRanges: []
      }
    ]);

    expect(graph).toContain('concat=n=2:v=1:a=1[outv][outa]');
    expect(graph).toContain("volume=0:enable='between(t,2,4)'");
  });
});

describe('processor integration', () => {
  it('returns a clear error for invalid JSON', async () => {
    const directory = await createTempDir();
    const inputPath = path.join(directory, 'input.mp4');
    const filtersPath = path.join(directory, 'filters.json');
    const outputPath = path.join(directory, 'output.mp4');

    await createFixtureVideo(inputPath);
    await writeFile(filtersPath, '{invalid json', 'utf8');

    await expect(processMedia({ inputPath, filtersPath, outputPath })).rejects.toThrow('Invalid JSON');
  });

  it('creates a playable mute-only output', async () => {
    const directory = await createTempDir();
    const inputPath = path.join(directory, 'input.mp4');
    const filtersPath = path.join(directory, 'filters.json');
    const outputPath = path.join(directory, 'output.mp4');

    await createFixtureVideo(inputPath);
    await writeFile(
      filtersPath,
      createFilterFile(4, [{ id: 'mute-1', type: 'mute', start: 1, end: 2 }]),
      'utf8'
    );

    await processMedia({ inputPath, filtersPath, outputPath });

    const mediaInfo = await probeMedia(outputPath);
    const silenceLog = await detectSilence(outputPath);

    expect(mediaInfo.duration).toBeGreaterThan(3.7);
    expect(mediaInfo.duration).toBeLessThan(4.2);
    expect(silenceLog).toContain('silence_start: 1');
  });

  it('creates continuous skip-only output with shorter duration', async () => {
    const directory = await createTempDir();
    const inputPath = path.join(directory, 'input.mp4');
    const filtersPath = path.join(directory, 'filters.json');
    const outputPath = path.join(directory, 'output.mp4');

    await createFixtureVideo(inputPath);
    await writeFile(
      filtersPath,
      createFilterFile(4, [{ id: 'skip-1', type: 'skip', start: 1, end: 2 }]),
      'utf8'
    );

    await processMedia({ inputPath, filtersPath, outputPath });

    const mediaInfo = await probeMedia(outputPath);

    expect(mediaInfo.duration).toBeGreaterThan(2.7);
    expect(mediaInfo.duration).toBeLessThan(3.3);
  });

  it('applies mute only to retained spans after a skip', async () => {
    const directory = await createTempDir();
    const inputPath = path.join(directory, 'input.mp4');
    const filtersPath = path.join(directory, 'filters.json');
    const outputPath = path.join(directory, 'output.mp4');

    await createFixtureVideo(inputPath);
    await writeFile(
      filtersPath,
      createFilterFile(4, [
        { id: 'skip-1', type: 'skip', start: 0, end: 1 },
        { id: 'mute-1', type: 'mute', start: 1, end: 2 }
      ]),
      'utf8'
    );

    await processMedia({ inputPath, filtersPath, outputPath });

    const silenceLog = await detectSilence(outputPath);
    const mediaInfo = await probeMedia(outputPath);
    const fileBuffer = await readFile(outputPath);

    expect(fileBuffer.byteLength).toBeGreaterThan(0);
    expect(mediaInfo.duration).toBeGreaterThan(2.7);
    expect(mediaInfo.duration).toBeLessThan(3.3);
    expect(silenceLog).toContain('silence_start: 0');
  });
});
