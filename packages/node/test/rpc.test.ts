import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DbxModelCatalogPython } from "../src/index.ts";
import { DbxModelCatalogWebSocket } from "../src/rpc.ts";
import { startCatalogServer, type CatalogServer } from "../src/server/app.ts";
import type { ModelCatalog } from "../src/generated/catalog-types.ts";

const workspaceRoot = path.resolve(import.meta.dir, "../../..");
const pythonProject = path.join(workspaceRoot, "packages/python");
const catalogPromise = Bun.file(path.join(workspaceRoot, "site/catalog.json")).json() as Promise<ModelCatalog>;
let server: CatalogServer;

beforeAll(async () => {
  server = await startCatalogServer({
    port: 0,
    python: {
      project: false,
      with: [],
      withEditable: [pythonProject],
    },
    siteDirectory: path.join(workspaceRoot, "site"),
  });
});

afterAll(async () => {
  await server.close();
});

describe("catalog Pynect transports", () => {
  test("serves the site and browser WebSocket endpoint", async () => {
    const health = await fetch(new URL("/health", server.url));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    await using python = new DbxModelCatalogWebSocket({ baseUrl: server.url });
    const info = await python.venv.ready();
    expect(info.url).toBe(new URL("/pynect", server.url).href.replace("http:", "ws:"));
  });

  test("returns the same generated client contract over IPC and WebSocket", async () => {
    const catalog = await catalogPromise;
    await using local = new DbxModelCatalogPython({
      project: false,
      with: [],
      withEditable: [pythonProject],
    });
    await using remote = new DbxModelCatalogWebSocket({ baseUrl: server.url });
    const [localModule, remoteModule] = await Promise.all([local.client, remote.client]);
    const [localClient, remoteClient] = await Promise.all([
      localModule.NodeModelCatalogClient(catalog as unknown as Record<string, unknown>),
      remoteModule.NodeModelCatalogClient(catalog as unknown as Record<string, unknown>),
    ]);

    try {
      const [localSize, remoteSize, localResult, remoteResult] = await Promise.all([
        localClient.get_size(),
        remoteClient.get_size(),
        localClient.query({ status: { $eq: "active" } }, { limit: 2, orderBy: "name" }),
        remoteClient.query({ status: { $eq: "active" } }, { limit: 2, orderBy: "name" }),
      ]);
      expect(remoteSize).toBe(localSize);
      expect(remoteResult).toEqual(localResult);
    } finally {
      await Promise.all([localClient.$release(), remoteClient.$release()]);
    }
  }, 120_000);
});
