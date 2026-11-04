import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCatalogRpcClient } from "../src/rpc.ts";
import { createCatalogRpcApp } from "../src/server/app.ts";

const workspaceRoot = path.resolve(import.meta.dir, "../../..");
const app = createCatalogRpcApp({
  catalogPath: path.join(workspaceRoot, "site/catalog.json"),
  python: {
    project: false,
    with: [],
    withEditable: [path.join(workspaceRoot, "packages/python")],
  },
  siteDirectory: path.join(workspaceRoot, "site"),
});

let client: ReturnType<typeof createCatalogRpcClient>;

beforeAll(() => {
  app.listen({ hostname: "127.0.0.1", port: 0 });
  client = createCatalogRpcClient(`http://127.0.0.1:${app.server?.port}`);
});

afterAll(async () => {
  await app.stop();
});

describe("catalog RPC", () => {
  test("serves health and the generated catalog contract", async () => {
    const health = await client.rpc.health.get();
    expect(health.error).toBeNull();
    expect(health.data).toEqual({ ok: true });

    const catalog = await client.rpc.catalog.get();
    expect(catalog.error).toBeNull();
    expect(catalog.data?.schema_version).toBeGreaterThan(0);
    expect(Object.keys(catalog.data?.models ?? {}).length).toBeGreaterThan(0);
    expect(typeof catalog.data?.updated_at).toBe("string");
  });

  test("supports typed model lookup and query", async () => {
    const catalog = await client.rpc.catalog.get();
    const modelId = Object.keys(catalog.data?.models ?? {})[0];
    expect(modelId).toBeDefined();

    const model = await client.rpc.models({ id: modelId! }).get();
    expect(model.error).toBeNull();
    expect(model.data?.id).toBe(modelId);

    const query = await client.rpc.query.post({
      expression: { status: { $eq: "active" } },
      options: { limit: 2, orderBy: "name" },
    });
    expect(query.error).toBeNull();
    expect(query.data).toHaveLength(2);
    expect(query.data?.every(record => record.status === "active")).toBe(true);
  }, 15_000);
});
