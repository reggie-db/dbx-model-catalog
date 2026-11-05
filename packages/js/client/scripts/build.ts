import { chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const dist = resolve(root, 'dist');
await rm(dist, { force: true, recursive: true });

const nodeResult = await Bun.build({
  entrypoints: [resolve(root, 'src/index.ts'), resolve(root, 'src/cli.ts')],
  external: ['@chanx-js/client', 'pynect'],
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
await chmod(resolve(dist, 'cli.js'), 0o755);
