import { describe, expect, test } from "bun:test";
import {
  createModelCatalogIndex,
  enrichLiveModels,
  modelProviderFamily,
  normalizeModelIdentity,
} from "../src/browser.js";
import {
  CatalogCapabilitiesSchema,
  CatalogModelRecordSchema,
  CatalogStatusSchema,
  parseCatalogSearchIndex,
  parseCatalogModelRecord,
  parseModelCatalog,
} from "../src/validation.js";

const catalog = parseModelCatalog(
  await Bun.file(new URL("../../web/catalog.json", import.meta.url)).json(),
);
const searchIndex = parseCatalogSearchIndex(
  await Bun.file(new URL("../../web/search-index.json", import.meta.url)).json(),
);
const modelCatalogIndex = createModelCatalogIndex(catalog, searchIndex);

describe("model catalog index", () => {
  test("resolves endpoint, system-service, and provider identities", () => {
    const endpoint = modelCatalogIndex.resolve("databricks-gpt-6-1-sol");
    const service = modelCatalogIndex.resolve("system.ai.gpt-6-1-sol");
    const provider = modelCatalogIndex.resolve("openai/gpt-6.1-sol");

    expect(endpoint?.record.id).toBe("databricks-gpt-6-1-sol");
    expect(service?.record.id).toBe(endpoint?.record.id);
    expect(service?.identity.kind).toBe("model-service");
    expect(provider?.record.id).toBe(endpoint?.record.id);
    expect(provider?.identity.kind).toBe("provider");
  });

  test("returns scored search details without changing ranked records", () => {
    const [match] = modelCatalogIndex.search("gpt 6.1 sol", 1);
    expect(match?.record.id).toBe("databricks-gpt-6-1-sol");
    expect(match?.score).toBeGreaterThan(0);
    expect(match?.relevance).toBeGreaterThan(0);
  });

  test("keeps undocumented live models while enriching known endpoints", () => {
    const live = [
      { name: "workspace-custom-model" },
      { name: "databricks-claude-sonnet-4-6", service: "system.ai.claude-sonnet-4-6" },
    ];
    const enriched = enrichLiveModels(
      modelCatalogIndex,
      live,
      model => [model.name, ...(model.service ? [model.service] : [])],
    );

    expect(enriched).toHaveLength(2);
    expect(enriched[0]?.published).toBeUndefined();
    expect(enriched[1]?.published?.record.id).toBe("databricks-claude-sonnet-4-6");
  });
});

test("normalizes routing identities independently of catalog lineage", () => {
  expect(normalizeModelIdentity("system.ai.databricks-gpt-6.1-sol")).toBe("gpt-6-1-sol");
  expect(modelProviderFamily("openai/gpt-6.1-sol")).toBe("gpt");
  expect(modelProviderFamily("anthropic/claude-sonnet-4-6")).toBe("claude");
});

test("rejects untrusted catalog payloads that only satisfy TypeScript casts", () => {
  expect(() => parseModelCatalog({ schema_version: 16, models: {} })).toThrow();
});

test("exports composable runtime schemas for catalog-owned contracts", () => {
  const record = modelCatalogIndex.records[0];
  if (!record) throw new Error("Catalog is empty");
  expect(CatalogModelRecordSchema.parse(record)).toEqual(record);
  expect(parseCatalogModelRecord(record)).toEqual(record);
  expect(CatalogCapabilitiesSchema.parse(record.capabilities)).toEqual(record.capabilities);
  expect(CatalogStatusSchema.parse(record.status)).toBe(record.status);
  expect(() => CatalogModelRecordSchema.parse({ id: record.id })).toThrow();
});
