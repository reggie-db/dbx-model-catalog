import { existsSync, readFileSync } from "node:fs";
import { createModelCatalogIndex } from "./catalog-index.js";
import { parseCatalogSearchIndex, parseModelCatalog } from "./validation.js";

function bundledFile(name: string): URL {
  const candidates = [
    new URL(name, import.meta.url),
    new URL(`../../web/${name}`, import.meta.url),
  ];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error(`Bundled model catalog file is missing: ${name}`);
  return found;
}

export const BUNDLED_MODEL_CATALOG = parseModelCatalog(
  JSON.parse(readFileSync(bundledFile("catalog.json"), "utf8")),
);

export const BUNDLED_CATALOG_SEARCH_INDEX = parseCatalogSearchIndex(
  JSON.parse(readFileSync(bundledFile("search-index.json"), "utf8")),
);

/** Offline, synchronous index shipped with the npm package. */
export const bundledModelCatalogIndex = createModelCatalogIndex(
  BUNDLED_MODEL_CATALOG,
  BUNDLED_CATALOG_SEARCH_INDEX,
);

export * from "./catalog-index.js";
export * from "./identity.js";
