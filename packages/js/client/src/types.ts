import type {
  CatalogFilters,
  CatalogModelRecord,
  CatalogSearchIndexPayload,
  ModelCatalog,
} from "./_generated/schemas.js";
import type { CatalogIdentityMatch } from "./catalog-index.js";
import type { CatalogSearchMatch } from "./search.js";

export interface CatalogClient {
  catalog(): Promise<ModelCatalog>;
  searchIndex(): Promise<CatalogSearchIndexPayload>;
  list(filters?: CatalogFilters): Promise<CatalogModelRecord[]>;
  get(identity: string): Promise<CatalogModelRecord | undefined>;
  resolve(identity: string): Promise<CatalogIdentityMatch | undefined>;
  search(query: string, limit?: number | null): Promise<CatalogSearchMatch[]>;
  stream(filters?: CatalogFilters): AsyncGenerator<CatalogModelRecord>;
  close(): void;
}
