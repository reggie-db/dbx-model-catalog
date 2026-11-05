import { createCatalogClientFromOptions } from "./client.js";
import type { CatalogClient } from "./types.js";

export type * from "./_generated/schemas.js";
export type * from "./types.js";

export interface CatalogClientOptions {
  baseUrl: string;
}

export function createCatalogClient(options: CatalogClientOptions): CatalogClient {
  return createCatalogClientFromOptions(options);
}
