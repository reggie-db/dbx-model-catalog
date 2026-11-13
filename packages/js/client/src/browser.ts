import { createModelCatalogClient } from "./local-client.js";
import type { CatalogClient } from "./types.js";
import { createModelCatalogIndex, type ModelCatalogIndex } from "./catalog-index.js";
import {
  PUBLISHED_CATALOG_SEARCH_INDEX_URL,
  PUBLISHED_CATALOG_URL,
} from "./_generated/published.js";
import { parseCatalogSearchIndex, parseModelCatalog } from "./validation.js";

export type * from "./_generated/schemas.js";
export type * from "./types.js";
export {
  PUBLISHED_CATALOG_DATABASE_URL,
  PUBLISHED_CATALOG_INDEX_URL,
  PUBLISHED_CATALOG_ROOT_URL,
  PUBLISHED_CATALOG_SCHEMA_URL,
  PUBLISHED_CATALOG_SCHEMA_VERSION,
  PUBLISHED_CATALOG_SEARCH_INDEX_URL,
  PUBLISHED_CATALOG_URL,
} from "./_generated/published.js";

export interface LoadModelCatalogOptions {
  catalogUrl?: string;
  fetch?: typeof globalThis.fetch;
  searchIndexUrl?: string;
}

export async function loadModelCatalog(
  options: LoadModelCatalogOptions = {},
): Promise<CatalogClient> {
  const index = await loadModelCatalogIndex(options);
  return createModelCatalogClient(index.catalog, index.searchIndex);
}

export async function loadModelCatalogIndex(
  options: LoadModelCatalogOptions = {},
): Promise<ModelCatalogIndex> {
  const loader = options.fetch ?? globalThis.fetch;
  const catalogUrl = options.catalogUrl ?? PUBLISHED_CATALOG_URL;
  const searchIndexUrl = options.searchIndexUrl ?? (
    options.catalogUrl
      ? new URL("search-index.json", options.catalogUrl).toString()
      : PUBLISHED_CATALOG_SEARCH_INDEX_URL
  );
  const [catalogResponse, searchIndexResponse] = await Promise.all([
    loader(catalogUrl),
    loader(searchIndexUrl),
  ]);
  if (!catalogResponse.ok) throw new Error(`Catalog request failed with ${catalogResponse.status}`);
  if (!searchIndexResponse.ok) {
    throw new Error(`Search index request failed with ${searchIndexResponse.status}`);
  }
  return createModelCatalogIndex(
    parseModelCatalog(await catalogResponse.json()),
    parseCatalogSearchIndex(await searchIndexResponse.json()),
  );
}

export * from "./catalog-index.js";
export * from "./identity.js";
export * from "./validation.js";
export { createModelCatalogClient } from "./local-client.js";
export { filterCatalogRecords } from "./local-client.js";
export { searchCatalogMatches, searchCatalogRecords } from "./search.js";
