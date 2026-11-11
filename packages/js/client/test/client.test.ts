import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import {
  PUBLISHED_CATALOG_INDEX_URL,
  PUBLISHED_CATALOG_SCHEMA_VERSION,
  PUBLISHED_CATALOG_URL,
  connectModelCatalog,
} from '../src/index.js';

test('exports schema-scoped catalog URLs', () => {
  expect(PUBLISHED_CATALOG_SCHEMA_VERSION).toBe(16);
  expect(PUBLISHED_CATALOG_URL).toEndWith('/catalog/v16/catalog.json');
  expect(PUBLISHED_CATALOG_INDEX_URL).toEndWith('/catalog/index.json');
});

test('uses local files without starting Python and filters the catalog', async () => {
  const previousCatalogPath = process.env.DBX_MODEL_CATALOG_PATH;
  process.env.DBX_MODEL_CATALOG_PATH = fileURLToPath(
    new URL('../../web/catalog.json', import.meta.url),
  );
  try {
    await using session = await connectModelCatalog();
    const models = await session.client.list({ query: 'gpt', limit: 2 });
    const searchIndex = await session.client.searchIndex();

    expect(session.mode).toBe('file');
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.id).toBe('databricks-gpt-6-1-sol');
    expect(models.every(model => `${model.id} ${model.name}`.toLowerCase().includes('gpt'))).toBe(true);
    expect(searchIndex.documents.length).toBeGreaterThan(0);
  } finally {
    if (previousCatalogPath === undefined) delete process.env.DBX_MODEL_CATALOG_PATH;
    else process.env.DBX_MODEL_CATALOG_PATH = previousCatalogPath;
  }
}, 30_000);

test('rejects WebSocket URLs from the standalone client', async () => {
  expect(connectModelCatalog('ws://127.0.0.1:8787')).rejects.toThrow(
    '@dbx-tools/dbx-model-catalog/pynect',
  );
});
