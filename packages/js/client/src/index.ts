import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogClient } from "./types.js";
import type { CatalogSearchIndexPayload, ModelCatalog } from "./_generated/schemas.js";
import {
  PUBLISHED_CATALOG_SEARCH_INDEX_URL,
  PUBLISHED_CATALOG_URL,
} from "./_generated/published.js";
import { createModelCatalogClient } from "./local-client.js";
import { parseCatalogSearchIndex, parseModelCatalog } from "./validation.js";

const packageRootUrl = new URL("..", import.meta.url);
const packageRoot = fileURLToPath(packageRootUrl);

export interface ConnectModelCatalogOptions {
  catalogPath?: string;
  catalogUrl?: string;
  fetch?: typeof globalThis.fetch;
  searchIndexPath?: string;
  searchIndexUrl?: string;
}

export interface ModelCatalogSession extends AsyncDisposable {
  readonly client: CatalogClient;
  readonly mode: "file" | "published" | "url";
  readonly root: string;
  readonly source: string;
  close(): Promise<void>;
}

export async function connectModelCatalog(
  input?: string | ConnectModelCatalogOptions,
): Promise<ModelCatalogSession> {
  const options = typeof input === "string" ? { catalogUrl: input } : (input ?? {});
  const configuredPath = options.catalogPath ?? process.env.DBX_MODEL_CATALOG_PATH;
  const configuredUrl = options.catalogUrl?.trim() || undefined;
  if (configuredUrl?.startsWith("ws:") || configuredUrl?.startsWith("wss:")) {
    throw new Error("WebSocket connections use @dbx-tools/dbx-model-catalog/pynect");
  }
  const loaded = configuredPath
    ? await loadFiles(configuredPath, options.searchIndexPath)
    : await loadUrls(configuredUrl, options.searchIndexUrl, options.fetch);
  const client = createModelCatalogClient(loaded.catalog, loaded.searchIndex);
  const close = async (): Promise<void> => {
    client.close();
  };

  return {
    client,
    mode: configuredPath ? "file" : configuredUrl ? "url" : "published",
    root: packageRoot,
    source: loaded.source,
    close,
    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },
  };
}

async function loadFiles(
  catalogPath: string,
  searchIndexPath?: string,
): Promise<{ catalog: ModelCatalog; searchIndex: CatalogSearchIndexPayload; source: string }> {
  const resolvedCatalogPath = resolve(catalogPath);
  const resolvedSearchIndexPath = resolve(
    searchIndexPath ?? resolve(dirname(resolvedCatalogPath), "search-index.json"),
  );
  const [catalog, searchIndex] = await Promise.all([
    readFile(resolvedCatalogPath, "utf8").then(value => parseModelCatalog(JSON.parse(value))),
    readFile(resolvedSearchIndexPath, "utf8").then(value => parseCatalogSearchIndex(JSON.parse(value))),
  ]);
  return { catalog, searchIndex, source: resolvedCatalogPath };
}

async function loadUrls(
  catalogUrl?: string,
  searchIndexUrl?: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ catalog: ModelCatalog; searchIndex: CatalogSearchIndexPayload; source: string }> {
  const source = catalogUrl ?? PUBLISHED_CATALOG_URL;
  const indexSource = searchIndexUrl ?? (
    catalogUrl ? new URL("search-index.json", catalogUrl).toString() : PUBLISHED_CATALOG_SEARCH_INDEX_URL
  );
  const [catalogResponse, searchIndexResponse] = await Promise.all([
    fetcher(source),
    fetcher(indexSource),
  ]);
  if (!catalogResponse.ok) throw new Error(`Catalog request failed with ${catalogResponse.status}`);
  if (!searchIndexResponse.ok) {
    throw new Error(`Search index request failed with ${searchIndexResponse.status}`);
  }
  return {
    catalog: parseModelCatalog(await catalogResponse.json()),
    searchIndex: parseCatalogSearchIndex(await searchIndexResponse.json()),
    source,
  };
}

export type * from "./browser.js";
export {
  PUBLISHED_CATALOG_DATABASE_URL,
  PUBLISHED_CATALOG_INDEX_URL,
  PUBLISHED_CATALOG_ROOT_URL,
  PUBLISHED_CATALOG_SCHEMA_URL,
  PUBLISHED_CATALOG_SCHEMA_VERSION,
  PUBLISHED_CATALOG_SEARCH_INDEX_URL,
  PUBLISHED_CATALOG_URL,
  createModelCatalogClient,
  filterCatalogRecords,
  loadModelCatalog,
  loadModelCatalogIndex,
  searchCatalogRecords,
} from "./browser.js";
