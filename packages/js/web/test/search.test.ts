import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
  CatalogModelRecord,
  CatalogSearchIndexPayload,
  ModelCatalog,
} from "@dbx-tools/dbx-model-catalog/browser";
import { searchStaticCatalog } from "../src/search.js";

const catalogPath = fileURLToPath(new URL("../catalog.json", import.meta.url));
const searchIndexPath = fileURLToPath(new URL("../search-index.json", import.meta.url));
const catalog = await Bun.file(catalogPath).json() as ModelCatalog;
const index = await Bun.file(searchIndexPath).json() as CatalogSearchIndexPayload;
const models: CatalogModelRecord[] = Object.entries(catalog.models).map(([id, model]) => ({
  ...model,
  id,
}));

test("ranks broad family searches with Python-owned quality signals", () => {
  expect(searchStaticCatalog(index, models, "gpt")[0]?.id).toBe("databricks-gpt-6-1-sol");
});

test("uses explicit versions before quality tie breakers", () => {
  expect(searchStaticCatalog(index, models, "openai 6-1")[0]?.id).toBe("databricks-gpt-6-1-sol");
});

test("uses Fuse only when strict token retrieval misses", () => {
  expect(searchStaticCatalog(index, models, "claud sonet")[0]?.id).toBe("databricks-claude-sonnet-5-5");
});
