import { blobToBase64String } from "@metapages/hash-query";
import { describe, expect, test } from "bun:test";
import {
  decodeCatalogViewState,
  encodeCatalogViewState,
} from "../src/view-state.js";

describe("catalog view hash state", () => {
  test("round-trips a complete deep-link view", () => {
    const state = decodeCatalogViewState(blobToBase64String({
      version: 1,
      search: "reasoning",
      sorting: [{ id: "context", desc: true }],
      columnFilters: [{ id: "publisher", value: ["Anthropic", "OpenAI"] }],
      model: "databricks-gpt-6-1-sol",
      modelView: "json",
      descriptionExpanded: true,
    }));

    expect(decodeCatalogViewState(encodeCatalogViewState(state))).toEqual(state);
  });

  test("ignores malformed and outdated fields without failing", () => {
    expect(() => decodeCatalogViewState("not-valid-base64")).not.toThrow();

    const state = decodeCatalogViewState(blobToBase64String({
      version: 99,
      search: "gpt",
      sorting: [{ id: "removed-column", desc: true }, { id: "publisher", desc: false }],
      columnFilters: [
        { id: "removed-column", value: "old" },
        { id: "status", value: ["active", 42] },
      ],
      columnOrder: ["publisher", "model"],
      columnVisibility: { aliases: true },
      modelView: "removed-view",
      descriptionExpanded: "yes",
      futureOption: { enabled: true },
    }));

    expect(state.search).toBe("gpt");
    expect(state.sorting).toEqual([{ id: "publisher", desc: false }]);
    expect(state.columnFilters).toEqual([{ id: "status", value: ["active"] }]);
    expect(state.modelView).toBe("details");
    expect(state.descriptionExpanded).toBe(false);
    expect("columnOrder" in state).toBe(false);
    expect("columnVisibility" in state).toBe(false);
  });

  test("uses the legacy model query only when the hash has no model", () => {
    expect(decodeCatalogViewState(undefined, { legacyModel: "legacy-model" }).model).toBe("legacy-model");
    expect(decodeCatalogViewState(
      blobToBase64String({ model: "hash-model" }),
      { legacyModel: "legacy-model" },
    ).model).toBe("hash-model");
  });
});
