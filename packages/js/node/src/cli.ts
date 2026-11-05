#!/usr/bin/env bun

import type {
  CatalogFilters,
} from '@dbx-tools/dbx-model-catalog-common';
import { connectModelCatalog } from './index.js';

type Command = 'catalog' | 'models' | 'model-feed';

interface CliOptions {
  readonly command: Command;
  readonly filters: CatalogFilters;
  readonly url?: string;
}

const listOptions = new Set([
  '--status',
  '--type',
  '--publisher',
  '--task',
  '--capability',
]);
const scalarOptions = new Set(['--url', '--limit']);

function parseArgs(args: string[]): CliOptions {
  const command = args.shift();
  if (command === undefined || command === '--help' || command === '-h') {
    throw new Error(
      'Usage: bun run chanx-model-catalog <catalog|models|model-feed> [query] '
      + '[--status VALUE] [--type VALUE] [--publisher VALUE] [--task VALUE] '
      + '[--capability VALUE] [--limit NUMBER] '
      + '[--url ws://HOST:PORT]',
    );
  }
  if (!['catalog', 'models', 'model-feed'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const positional: string[] = [];
  const values = new Map<string, string[]>();
  while (args.length > 0) {
    const option = args.shift()!;
    if (!option.startsWith('--')) {
      positional.push(option);
      continue;
    }
    if (!listOptions.has(option) && !scalarOptions.has(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    values.set(option, [...(values.get(option) ?? []), value]);
  }
  if (positional.length > 1) throw new Error('Only one query may be provided.');

  const limit = numberOption(values, '--limit');
  const filters = {
    ...(positional[0] ? { query: positional[0] } : {}),
    ...(values.get('--status') ? { status: values.get('--status')! } : {}),
    ...(values.get('--type') ? { type: values.get('--type')! } : {}),
    ...(values.get('--publisher') ? { publisher: values.get('--publisher')! } : {}),
    ...(values.get('--task') ? { task: values.get('--task')! } : {}),
    ...(values.get('--capability') ? { capability: values.get('--capability')! } : {}),
    ...(limit === undefined ? {} : { limit }),
  } as CatalogFilters;
  return {
    command: command as Command,
    filters,
    ...(values.get('--url')?.[0] ? { url: values.get('--url')![0] } : {}),
  };
}

function numberOption(values: Map<string, string[]>, name: string): number | undefined {
  const value = values.get(name)?.[0];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await using session = await connectModelCatalog(options.url);
  process.stderr.write(
    session.mode === 'ipc'
      ? `Using local IPC (Python PID ${session.pid ?? 'starting'})\n`
      : `Using remote WebSocket ${options.url}\n`,
  );

  if (options.command === 'catalog') {
    process.stdout.write(`${JSON.stringify(await session.client.catalog())}\n`);
  } else if (options.command === 'models') {
    process.stdout.write(`${JSON.stringify(await session.client.list(options.filters), null, 2)}\n`);
  } else {
    for await (const model of session.client.stream(options.filters)) {
      process.stdout.write(`${JSON.stringify(model)}\n`);
    }
  }
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
