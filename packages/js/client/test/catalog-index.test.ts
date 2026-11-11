import { describe, expect, test } from "bun:test";
import { enrichLiveModels, modelProviderFamily, normalizeModelIdentity } from "../src/browser.js";
import { bundledModelCatalogIndex } from "../src/snapshot.js";
import { parseModelCatalog } from "../src/validation.js";

describe("bundled model catalog index", () => {
  test("resolves endpoint, system-service, and provider identities", () => {
    const endpoint = bundledModelCatalogIndex.resolve("databricks-gpt-6-1-sol");
    const service = bundledModelCatalogIndex.resolve("system.ai.gpt-6-1-sol");
    const provider = bundledModelCatalogIndex.resolve("openai/gpt-6.1-sol");

    expect(endpoint?.record.id).toBe("databricks-gpt-6-1-sol");
    expect(service?.record.id).toBe(endpoint?.record.id);
    expect(service?.identity.kind).toBe("model-service");
    expect(provider?.record.id).toBe(endpoint?.record.id);
    expect(provider?.identity.kind).toBe("provider");
  });

  test("returns scored search details without changing ranked records", () => {
    const [match] = bundledModelCatalogIndex.search("gpt 6.1 sol", 1);
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
      bundledModelCatalogIndex,
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
