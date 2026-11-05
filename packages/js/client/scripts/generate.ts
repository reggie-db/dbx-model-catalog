import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(
  new URL('../../../py/server', import.meta.url),
);
const catalogPath = fileURLToPath(
  new URL('../../web/catalog.json', import.meta.url),
);
process.env.DBX_MODEL_CATALOG_PATH ??= catalogPath;
const { generateProject } = await import('pynect');
const result = await generateProject({ root: serverRoot });

process.stdout.write(`Generated ${result.channels} channel(s) in ${result.outDir}\n`);
