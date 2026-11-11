import catalogJson from "../../web/catalog.json" with { type: "json" };
import searchIndexJson from "../../web/search-index.json" with { type: "json" };
import type { CatalogSearchIndexPayload, ModelCatalog } from "./_generated/schemas.js";
import { createModelCatalogIndex } from "./catalog-index.js";
import { parseCatalogSearchIndex, parseModelCatalog } from "./validation.js";

export const BUNDLED_MODEL_CATALOG: ModelCatalog = parseModelCatalog(catalogJson);

export const BUNDLED_CATALOG_SEARCH_INDEX: CatalogSearchIndexPayload =
  parseCatalogSearchIndex(searchIndexJson);

/** Offline, synchronous index shipped with the npm package. */
export const bundledModelCatalogIndex = createModelCatalogIndex(
  BUNDLED_MODEL_CATALOG,
  BUNDLED_CATALOG_SEARCH_INDEX,
);

export * from "./catalog-index.js";
export * from "./identity.js";
