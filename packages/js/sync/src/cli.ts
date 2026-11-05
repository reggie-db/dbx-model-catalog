#!/usr/bin/env bun

import { fileURLToPath } from 'node:url';

interface SyncOptions {
  readonly outputDirectory: string;
  readonly refresh: boolean;
}

const workspaceRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const syncRoot = fileURLToPath(new URL('../../../../packages/py/sync', import.meta.url));

function parseArgs(args: string[]): SyncOptions {
  let outputDirectory = 'packages/js/web';
  let refresh = false;

  while (args.length > 0) {
    const option = args.shift();
    if (option === '--refresh') {
      refresh = true;
      continue;
    }
    if (option === '--output-directory') {
      const value = args.shift();
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --output-directory');
      }
      outputDirectory = value;
      continue;
    }
    if (option === '--help' || option === '-h') {
      process.stdout.write(
        'Usage: bun run sync [--refresh] [--output-directory PATH]\n',
      );
      process.exit(0);
    }
    throw new Error(`Unknown option: ${option}`);
  }

  return { outputDirectory, refresh };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const python = [
    'import sys',
    'from dbx_model_catalog_sync import publish_catalog',
    'publish_catalog(sys.argv[1], refresh=sys.argv[2] == "true")',
  ].join('; ');
  const child = Bun.spawn(
    [
      process.env.UV || 'uv',
      'run',
      '--project',
      syncRoot,
      'python',
      '-c',
      python,
      options.outputDirectory,
      String(options.refresh),
    ],
    {
      cwd: workspaceRoot,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
