import type {
  CatalogFilters,
  CatalogModelRecord,
  CatalogSearchIndexPayload,
  ModelCatalog,
} from "./_generated/schemas.js";
import type { CatalogClient } from "./types.js";
import { createModelCatalogIndex } from "./catalog-index.js";
import { filterCatalogRecords } from "./filter.js";

export function createModelCatalogClient(
  catalog: ModelCatalog,
  searchIndex: CatalogSearchIndexPayload,
): CatalogClient {
  if (catalog.schema_version !== searchIndex.catalog_schema_version) {
    throw new Error(
      `Catalog schema v${catalog.schema_version} does not match search index schema v${searchIndex.catalog_schema_version}`,
    );
  }
  if (catalog.updated_at !== searchIndex.updated_at) {
    throw new Error("Catalog and search index timestamps do not match");
  }
  const records: CatalogModelRecord[] = Object.entries(catalog.models).map(([id, model]) => ({
    ...model,
    id,
  }));
  const index = createModelCatalogIndex(catalog, searchIndex);

  return {
    async catalog(): Promise<ModelCatalog> {
      return catalog;
    },

    async searchIndex(): Promise<CatalogSearchIndexPayload> {
      return searchIndex;
    },

    async list(filters: CatalogFilters = {}): Promise<CatalogModelRecord[]> {
      return filterCatalogRecords(records, searchIndex, filters);
    },

    async get(identity: string): Promise<CatalogModelRecord | undefined> {
      return index.resolve(identity)?.record;
    },

    async resolve(identity: string) {
      return index.resolve(identity);
    },

    async search(query: string, limit: number | null = 50) {
      return index.search(query, limit);
    },

    async *stream(filters: CatalogFilters = {}): AsyncGenerator<CatalogModelRecord> {
      for (const record of filterCatalogRecords(records, searchIndex, filters)) yield record;
    },

    close(): void {},
  };
}

export { filterCatalogRecords } from "./filter.js";
