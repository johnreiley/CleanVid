#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { processMedia } from './processor.js';

export async function runCli(argv: string[], io: Pick<Console, 'error' | 'log'> = console): Promise<number> {
  if (argv.length !== 3) {
    io.error('Usage: cleanvid <input> <filters.json> <output.mp4>');
    return 1;
  }

  const [inputPath, filtersPath, outputPath] = argv;

  try {
    await processMedia({ inputPath, filtersPath, outputPath });
    io.log(`Created ${outputPath}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
