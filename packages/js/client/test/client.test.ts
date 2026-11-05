import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { connectModelCatalog } from '../src/index.js';

test('uses local IPC by default and filters the catalog', async () => {
  const previousCatalogPath = process.env.DBX_MODEL_CATALOG_PATH;
  process.env.DBX_MODEL_CATALOG_PATH = fileURLToPath(
    new URL('../../web/catalog.json', import.meta.url),
  );
  try {
    await using session = await connectModelCatalog();
    const models = await session.client.list({ query: 'gpt', limit: 2 });
    const searchIndex = await session.client.searchIndex();

    expect(session.mode).toBe('ipc');
    expect(session.pid).toBeNumber();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]?.id).toBe('databricks-gpt-6-1-sol');
    expect(models.every(model => `${model.id} ${model.name}`.toLowerCase().includes('gpt'))).toBe(true);
    expect(searchIndex.documents.length).toBeGreaterThan(0);
  } finally {
    if (previousCatalogPath === undefined) delete process.env.DBX_MODEL_CATALOG_PATH;
    else process.env.DBX_MODEL_CATALOG_PATH = previousCatalogPath;
  }
}, 30_000);
