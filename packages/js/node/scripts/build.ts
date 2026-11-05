import { chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const dist = resolve(root, 'dist');
await rm(dist, { force: true, recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(root, 'src/index.ts'), resolve(root, 'src/cli.ts')],
  external: ['pynect'],
  format: 'esm',
  outdir: dist,
  sourcemap: 'external',
  target: 'node',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await chmod(resolve(dist, 'cli.js'), 0o755);
