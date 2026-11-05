import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const workspaceRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const serverRoot = fileURLToPath(
  new URL('../../../../packages/py/server', import.meta.url),
);
const execFileAsync = promisify(execFile);

export interface ConnectModelCatalogOptions {
  python?: string;
  url?: string;
}

export async function connectModelCatalog(
  input?: string | ConnectModelCatalogOptions,
) {
  const [{ createCatalogClient }, { startWorker }] = await Promise.all([
    import('@dbx-tools/dbx-model-catalog-common'),
    import('pynect'),
  ]);
  const options = typeof input === 'string' ? { url: input } : input ?? {};
  const remoteUrl = options.url?.trim() || undefined;
  const worker = remoteUrl
    ? undefined
    : await startWorker({
        python: options.python ?? await resolvePythonExecutable(),
        root: serverRoot,
      });
  const client = createCatalogClient(
    remoteUrl ? { baseUrl: remoteUrl } : worker!.clientOptions,
  );

  return {
    client,
    mode: remoteUrl ? 'remote' as const : 'ipc' as const,
    root: workspaceRoot,
    get pid(): number | undefined {
      return worker?.pid;
    },
    async close(): Promise<void> {
      client.close();
      await worker?.close();
    },
    async [Symbol.asyncDispose](): Promise<void> {
      await this.close();
    },
  };
}

async function resolvePythonExecutable(): Promise<string> {
  const { stdout } = await execFileAsync(
    'uv',
    [
      'run',
      '--project',
      serverRoot,
      'python',
      '-c',
      'import sys; print(sys.executable)',
    ],
    { cwd: workspaceRoot },
  );
  const python = stdout.trim();
  if (!python) throw new Error('uv did not resolve a Python executable');
  return python;
}

export type * from '@dbx-tools/dbx-model-catalog-common';
