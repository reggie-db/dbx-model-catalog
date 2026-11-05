import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(
  new URL('../../../py/server', import.meta.url),
);
const { generateProject } = await import('pynect');
const result = await generateProject({ root: serverRoot });

process.stdout.write(`Generated ${result.channels} channel(s) in ${result.outDir}\n`);
