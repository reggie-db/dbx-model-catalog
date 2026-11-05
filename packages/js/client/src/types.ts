import type {
  CatalogFilters,
  CatalogModelRecord,
  CatalogSearchIndexPayload,
  ModelCatalog,
} from "./_generated/schemas.js";

export interface CatalogClient {
  catalog(): Promise<ModelCatalog>;
  searchIndex(): Promise<CatalogSearchIndexPayload>;
  list(filters?: CatalogFilters): Promise<CatalogModelRecord[]>;
  stream(filters?: CatalogFilters): AsyncGenerator<CatalogModelRecord>;
  close(): void;
}
