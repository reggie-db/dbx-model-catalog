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
const asyncApiPath = new URL('../src/_generated/asyncapi.json', import.meta.url);
const asyncApi = (await Bun.file(asyncApiPath).json()) as {
  components?: { schemas?: Record<string, unknown> };
};
const schemas = asyncApi.components?.schemas;
if (!schemas?.ModelCatalog || !schemas.CatalogSearchIndexPayload) {
  throw new Error('Generated AsyncAPI is missing catalog schemas');
}
const rewriteReferences = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(rewriteReferences);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === '$ref' && typeof nested === 'string'
        ? nested.replace('#/components/schemas/', '#/$defs/')
        : rewriteReferences(nested),
    ]),
  );
};
const schemaDocument = (name: string) => ({
  ...(rewriteReferences(schemas[name]) as Record<string, unknown>),
  $defs: rewriteReferences(schemas),
});
await Bun.write(
  new URL('../src/_generated/json-schema.ts', import.meta.url),
  '// Generated from the Python-owned AsyncAPI contract. Do not edit.\n' +
    `export const MODEL_CATALOG_JSON_SCHEMA = ${JSON.stringify(schemaDocument('ModelCatalog'))} as const;\n` +
    `export const CATALOG_SEARCH_INDEX_JSON_SCHEMA = ${JSON.stringify(schemaDocument('CatalogSearchIndexPayload'))} as const;\n`,
);
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
