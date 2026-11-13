import { chmod, copyFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const workspaceRoot = resolve(root, '../../..');
const dist = resolve(root, 'dist');
await rm(dist, { force: true, recursive: true });

const nodeResult = await Bun.build({
  entrypoints: [resolve(root, 'src/index.ts'), resolve(root, 'src/cli.ts')],
  external: ['fs-ext'],
  format: 'esm',
  outdir: dist,
  sourcemap: 'external',
  target: 'node',
});

if (!nodeResult.success) {
  for (const log of nodeResult.logs) console.error(log);
  process.exit(1);
}
const browserResult = await Bun.build({
  entrypoints: [resolve(root, 'src/browser.ts')],
  format: 'esm',
  outdir: dist,
  sourcemap: 'external',
  target: 'browser',
});
if (!browserResult.success) {
  for (const log of browserResult.logs) console.error(log);
  process.exit(1);
}
const pynectResult = await Bun.build({
  entrypoints: [resolve(root, 'src/pynect.ts')],
  external: ['@chanx-js/client', 'pynect'],
  format: 'esm',
  outdir: dist,
  sourcemap: 'external',
  target: 'browser',
});
if (!pynectResult.success) {
  for (const log of pynectResult.logs) console.error(log);
  process.exit(1);
}
const snapshotResult = await Bun.build({
  entrypoints: [resolve(root, 'src/snapshot.ts')],
  format: 'esm',
  outdir: dist,
  sourcemap: 'external',
  target: 'node',
});
if (!snapshotResult.success) {
  for (const log of snapshotResult.logs) console.error(log);
  process.exit(1);
}
const snapshotOutput = await readFile(resolve(dist, 'snapshot.js'), 'utf8');
// The container workspace is `/workspace`, which can also occur legitimately in
// catalog URLs. Check the package directory so only an embedded local file path
// fails the build.
if (snapshotOutput.includes(root)) {
  throw new Error('Bundled snapshot contains a machine-local workspace path');
}
await Promise.all([
  copyFile(resolve(root, '../web/catalog.json'), resolve(dist, 'catalog.json')),
  copyFile(resolve(root, '../web/search-index.json'), resolve(dist, 'search-index.json')),
]);
await emitDeclarations();
await chmod(resolve(dist, 'cli.js'), 0o755);

async function emitDeclarations(): Promise<void> {
  const child = Bun.spawn(
    [process.execPath, 'run', 'tsc', '--project', resolve(root, 'tsconfig.build.json')],
    {
      cwd: workspaceRoot,
      stderr: 'inherit',
      stdout: 'inherit',
    },
  );
  if (await child.exited !== 0) {
    throw new Error('TypeScript declaration generation failed');
  }
}
