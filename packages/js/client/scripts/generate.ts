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
const catalog = (await Bun.file(catalogPath).json()) as {
  schema_version?: unknown;
};
if (!Number.isInteger(catalog.schema_version) || Number(catalog.schema_version) < 1) {
  throw new Error(`Invalid catalog schema_version: ${catalog.schema_version}`);
}
const schemaVersion = Number(catalog.schema_version);
const publishedRootUrl =
  'https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web';
await Bun.write(
  new URL('../src/_generated/published.ts', import.meta.url),
  `export const PUBLISHED_CATALOG_SCHEMA_VERSION = ${schemaVersion} as const;\n` +
    `export const PUBLISHED_CATALOG_ROOT_URL = ${JSON.stringify(publishedRootUrl)};\n` +
    'export const PUBLISHED_CATALOG_INDEX_URL = `${PUBLISHED_CATALOG_ROOT_URL}/catalog/index.json`;\n' +
    'export const PUBLISHED_CATALOG_SCHEMA_URL = `${PUBLISHED_CATALOG_ROOT_URL}/catalog/v${PUBLISHED_CATALOG_SCHEMA_VERSION}`;\n' +
    'export const PUBLISHED_CATALOG_URL = `${PUBLISHED_CATALOG_SCHEMA_URL}/catalog.json`;\n' +
    'export const PUBLISHED_CATALOG_SEARCH_INDEX_URL = `${PUBLISHED_CATALOG_SCHEMA_URL}/search-index.json`;\n' +
    'export const PUBLISHED_CATALOG_DATABASE_URL = `${PUBLISHED_CATALOG_SCHEMA_URL}/catalog.sqlite`;\n',
);

process.stdout.write(`Generated ${result.channels} channel(s) in ${result.outDir}\n`);
