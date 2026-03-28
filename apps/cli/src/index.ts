#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { processMedia, type ProcessMediaProgressEvent } from './processor.js';

interface CliIo {
  error(message: string): void;
  log(message: string): void;
  write(message: string): void;
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }

  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function createProgressReporter(io: CliIo) {
  let activeEncodeLine = false;
  let lastEncodeLength = 0;

  const endEncodeLine = () => {
    if (!activeEncodeLine) {
      return;
    }

    io.write('\n');
    activeEncodeLine = false;
    lastEncodeLength = 0;
  };

  const report = (event: ProcessMediaProgressEvent) => {
    if (event.phase !== 'encode' || event.percent === undefined) {
      endEncodeLine();
      io.log(event.message);
      return;
    }

    const percentText = `${Math.round(event.percent * 100)}%`;
    const currentText = formatTimestamp(event.outTimeSeconds ?? 0);
    const totalText = formatTimestamp(event.totalDurationSeconds ?? 0);
    const speedText = event.speed ? ` | ${event.speed}` : '';
    const line = `Encoding ${percentText} | ${currentText} / ${totalText}${speedText}`;
    const paddedLine = line.padEnd(lastEncodeLength, ' ');

    io.write(`\r${paddedLine}`);
    activeEncodeLine = true;
    lastEncodeLength = line.length;
  };

  return {
    report,
    finishLine: endEncodeLine
  };
}

export async function runCli(
  argv: string[],
  io: CliIo = {
    log: (message) => console.log(message),
    error: (message) => console.error(message),
    write: (message) => process.stdout.write(message)
  }
): Promise<number> {
  if (argv.length !== 3) {
    io.error('Usage: cleanvid <input> <filters.json> <output.mp4>');
    return 1;
  }

  const [inputPath, filtersPath, outputPath] = argv;
  const reporter = createProgressReporter(io);

  try {
    await processMedia({
      inputPath,
      filtersPath,
      outputPath,
      onProgress: reporter.report
    });
    reporter.finishLine();
    io.log(`Created ${outputPath}`);
    return 0;
  } catch (error) {
    reporter.finishLine();
    const message = error instanceof Error ? error.message : String(error);
    io.error(message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
