import { createCatalogClientFromOptions } from "./client.js";
import type { CatalogClient } from "./types.js";

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

export interface CatalogClientOptions {
  baseUrl: string;
}

export function createCatalogClient(options: CatalogClientOptions): CatalogClient {
  return createCatalogClientFromOptions(options);
}
