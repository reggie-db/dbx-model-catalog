import { blobToBase64String, setHashParamsInUrl } from "@metapages/hash-query";
import { describe, expect, test } from "bun:test";
import {
  decodeCatalogViewState,
  encodeCatalogViewState,
} from "../src/view-state.js";

describe("catalog view hash state", () => {
  test("round-trips a complete deep-link view", () => {
    const state = decodeCatalogViewState({
      v: "1",
      search: "reasoning",
      sort: "context.desc",
      "filter.publisher": encodeURIComponent(JSON.stringify(["Anthropic", "OpenAI"])),
      model: "databricks-gpt-6-1-sol",
      mode: "json",
      description: "expanded",
    });

    expect(decodeCatalogViewState(encodeCatalogViewState(state))).toEqual(state);
    expect(encodeCatalogViewState(state)).toEqual({
      view: undefined,
      v: "1",
      search: "reasoning",
      sort: "context.desc",
      "filter.publisher": encodeURIComponent(JSON.stringify(["Anthropic", "OpenAI"])),
      model: "databricks-gpt-6-1-sol",
      mode: "json",
      description: "expanded",
    });
    expect(setHashParamsInUrl(
      "https://model-catalog.example/",
      encodeCatalogViewState(state),
    ).hash).toBe(
      "#?description=expanded&filter.publisher=%5B%22Anthropic%22%2C%22OpenAI%22%5D&mode=json&model=databricks-gpt-6-1-sol&search=reasoning&sort=context.desc&v=1",
    );
  });

  test("ignores malformed and outdated fields without failing", () => {
    expect(() => decodeCatalogViewState({ view: "not-valid-base64" })).not.toThrow();

    const state = decodeCatalogViewState({
      search: "gpt",
      sort: "removed-column.desc,publisher.asc,broken",
      "filter.removed-column": encodeURIComponent(JSON.stringify("old")),
      "filter.status": encodeURIComponent(JSON.stringify(["active", 42])),
      mode: "removed-view",
      description: "yes",
      futureOption: "enabled",
    });

    expect(state.search).toBe("gpt");
    expect(state.sorting).toEqual([{ id: "publisher", desc: false }]);
    expect(state.columnFilters).toEqual([{ id: "status", value: ["active"] }]);
    expect(state.modelView).toBe("details");
    expect(state.descriptionExpanded).toBe(false);
    expect("columnOrder" in state).toBe(false);
    expect("columnVisibility" in state).toBe(false);
  });

  test("migrates legacy base64 view links to readable hash params", () => {
    const state = decodeCatalogViewState({
      view: blobToBase64String({
        search: "legacy search",
        sorting: [{ id: "context", desc: true }],
        columnFilters: [{ id: "publisher", value: ["OpenAI"] }],
        model: "legacy-model",
      }),
    });

    expect(state.search).toBe("legacy search");
    expect(encodeCatalogViewState(state, { view: "legacy", "filter.old": "value" })).toMatchObject({
      view: undefined,
      search: "legacy%20search",
      sort: "context.desc",
      "filter.old": undefined,
      "filter.publisher": "%5B%22OpenAI%22%5D",
      model: "legacy-model",
    });
  });

  test("uses the legacy model query only when the hash has no model", () => {
    expect(decodeCatalogViewState({}, { legacyModel: "legacy-model" }).model).toBe("legacy-model");
    expect(decodeCatalogViewState(
      { model: "hash-model" },
      { legacyModel: "legacy-model" },
    ).model).toBe("hash-model");
  });
});
