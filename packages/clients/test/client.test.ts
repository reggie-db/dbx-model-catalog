import { brotliCompressSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { MODEL_CATALOG_SCHEMA_VERSION } from "@dbx-model-catalog/common";
import {
  ModelCatalogClient,
  parseCatalogQuery,
  serializeCatalogQuery,
  type SerializableCatalogQuery,
} from "../src/index.ts";

const catalog = {
  schema_version: MODEL_CATALOG_SCHEMA_VERSION,
  updated_at: "2026-10-31T12:00:00.000Z",
  models: {
    "databricks-gpt-active": {
      ...model("GPT Active", "active", ["reasoning"]),
      capabilities: {
        web_search: false,
        reasoning: { supported: true as const, effort: ["high" as const] },
      },
      limits: { context: 128_000 },
      rankings: [
        {
          domain: "text",
          category: "overall",
          rank: 2,
          published_at: "2026-10-30",
          metric: "rating" as const,
          rating: 1_250,
          lower: 1_200,
          upper: 1_300,
          variance: 25,
          votes: 500,
        },
        {
          domain: "text",
          category: "coding",
          rank: 1,
          published_at: "2026-10-30",
          metric: "score" as const,
          score: 0.95,
          lower: 0.9,
          upper: 1,
          observations: 100,
          sessions: 20,
        },
      ],
    },
    "databricks-gpt-preview": model("GPT Preview", "preview", ["reasoning"]),
    "databricks-llama": {
      ...model("Llama Active", "active", ["chat"]),
      limits: { context: 8_192 },
    },
  },
};

describe("ModelCatalogClient", () => {
  test("reads and validates Brotli-compressed catalog JSON", async () => {
    const compressed = brotliCompressSync(JSON.stringify(catalog));
    const client = await ModelCatalogClient.fromBrotli(compressed);

    expect(client.schemaVersion).toBe(MODEL_CATALOG_SCHEMA_VERSION);
    expect(client.updatedAt).toBe("2026-10-31T12:00:00.000Z");
    expect(client.size).toBe(3);
    expect(client.get("databricks-gpt-active")?.name).toBe("GPT Active");
  });

  test("loads Brotli bytes through an injected fetch implementation", async () => {
    const compressed = brotliCompressSync(JSON.stringify(catalog));
    const client = await ModelCatalogClient.fromUrl(
      "https://example.com/catalog.json.br",
      {
        fetch: async () => ({
          ok: true,
          status: 200,
          arrayBuffer: async () => compressed.buffer.slice(
            compressed.byteOffset,
            compressed.byteOffset + compressed.byteLength,
          ) as ArrayBuffer,
        }),
      },
    );

    expect(client.size).toBe(3);
  });

  test("accepts an injected decoder for runtimes without browser streams", async () => {
    const compressed = brotliCompressSync(JSON.stringify(catalog));
    const client = await ModelCatalogClient.fromBrotli(compressed, {
      decode: () => JSON.stringify(catalog),
    });

    expect(client.get("databricks-llama")?.name).toBe("Llama Active");
  });

  test("queries with Boolean filters, text search, sorting, and limits", () => {
    const client = ModelCatalogClient.fromCatalog(catalog);
    const results = client.query(
      {
        $and: [
          { status: { $eq: "active" } },
          { tasks: { $contains: "reasoning" } },
          { name: { $contains: "gpt" } },
          { $not: { name: { $contains: "preview" } } },
        ],
      },
      {
        orderBy: [{ field: "name", direction: "desc" }],
        limit: 1,
      },
    );

    expect(results.map(({ id }) => id)).toEqual(["databricks-gpt-active"]);
  });

  test("queries fully nested fields and returns complete model records", () => {
    const client = ModelCatalogClient.fromCatalog(catalog);
    const results = client.query(
      modelRecord =>
        modelRecord.status === "active" &&
        modelRecord.capabilities.reasoning?.supported === true &&
        modelRecord.rankings.some(
          ranking => ranking.metric === "rating" && ranking.rank <= 10,
        ),
      { orderBy: { field: "name", direction: "asc" } },
    );

    expect(results.map(({ id }) => id)).toEqual(["databricks-gpt-active"]);
    expect(results[0]?.description).toBe("GPT Active model");
    expect(results[0]?.capabilities.reasoning?.supported).toBe(true);
    expect(results[0]?.rankings[0]?.rank).toBe(2);
    expect(results[0]?.limits?.context).toBe(128_000);
  });

  test("serializes, parses, and executes typed object queries", () => {
    const client = ModelCatalogClient.fromCatalog(catalog);
    const query = {
      expression: {
        $and: [
          { status: { $eq: "active" } },
          { name: { $contains: "gpt" } },
          {
            capabilities: {
              web_search: { $eq: false },
              reasoning: { effort: { $contains: "high" } },
            },
          },
          { rankings: { metric: "rating", rank: { $lte: 10 } } },
        ],
      },
      options: {
        orderBy: { field: "name", direction: "asc" },
        limit: 10,
      },
    } satisfies SerializableCatalogQuery;

    const serialized = serializeCatalogQuery(query);
    const parsed = parseCatalogQuery(serialized);
    const results = client.query(parsed.expression, parsed.options);

    expect(serialized).toBe(JSON.stringify(query));
    expect(results.map(({ id }) => id)).toEqual(["databricks-gpt-active"]);
    expect(results[0]?.description).toBe("GPT Active model");
  });

  test("auto-matches single and multiple values against arrays", () => {
    const client = ModelCatalogClient.fromCatalog(catalog);
    const singleValue = client.query({
      $and: [
        { status: "active" },
        { tasks: "reasoning" },
        { rankings: { metric: "rating", rank: { $lte: 10 } } },
      ],
    });
    const multipleValues = client.query({
      $and: [
        { status: ["preview", "active"] },
        { tasks: ["missing", "reasoning"] },
        {
          rankings: [
            { metric: "score", rank: { $lte: 0 } },
            { metric: "rating", rank: { $lte: 10 } },
          ],
        },
      ],
    });

    expect(singleValue.map(({ id }) => id)).toEqual(["databricks-gpt-active"]);
    expect(multipleValues.map(({ id }) => id)).toEqual([
      "databricks-gpt-active",
    ]);
    expect(
      client.query({ rankings: { metric: "rating", rank: { $lte: 1 } } }),
    ).toEqual([]);
  });

  test("rejects non-serializable and unknown query input", () => {
    expect(() => parseCatalogQuery({ expression: () => true })).toThrow();
    expect(() =>
      parseCatalogQuery({ expression: { unknown: { $eq: true } } }),
    ).toThrow("Unknown catalog field");
    expect(() =>
      parseCatalogQuery({ expression: { status: { $unknown: "active" } } }),
    ).toThrow("Unknown filter operator");
    expect(() =>
      parseCatalogQuery({
        expression: { rankings: { unknown: "value" } },
      }),
    ).toThrow("Unknown catalog field");
    expect(() =>
      parseCatalogQuery({
        expression: {},
        options: { orderBy: "unknown" },
      }),
    ).toThrow("Unknown catalog sort field");
  });
});

function model(name: string, status: "active" | "preview", tasks: string[]) {
  return {
    name,
    description: `${name} model`,
    aliases: [],
    type: "chat" as const,
    status,
    modalities: { input: ["text" as const], output: ["text" as const] },
    capabilities: { web_search: false },
    tasks,
    use_cases: [],
    availability: {},
    price: {},
    average_price: {},
    notices: [],
    rankings: [],
    benchmarks: [],
  };
}
