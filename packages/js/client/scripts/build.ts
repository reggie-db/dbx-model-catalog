import { chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const workspaceRoot = resolve(root, '../../..');
const dist = resolve(root, 'dist');
const manifest = await Bun.file(resolve(root, 'package.json')).json() as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const external = [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
];
await rm(dist, { force: true, recursive: true });

const nodeResult = await Bun.build({
  entrypoints: [resolve(root, 'src/index.ts'), resolve(root, 'src/cli.ts')],
  external,
  format: 'esm',
  outdir: dist,
  target: 'node',
});

if (!nodeResult.success) {
  for (const log of nodeResult.logs) console.error(log);
  process.exit(1);
}
const browserResult = await Bun.build({
  entrypoints: [resolve(root, 'src/browser.ts')],
  external,
  format: 'esm',
  outdir: dist,
  target: 'browser',
});
if (!browserResult.success) {
  for (const log of browserResult.logs) console.error(log);
  process.exit(1);
}
const pynectResult = await Bun.build({
  entrypoints: [resolve(root, 'src/pynect.ts')],
  external,
  format: 'esm',
  outdir: dist,
  target: 'browser',
});
if (!pynectResult.success) {
  for (const log of pynectResult.logs) console.error(log);
  process.exit(1);
}
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
