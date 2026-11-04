import { brotliCompressSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "bun:test";
import { DbxModelCatalogPython } from "../src/index.ts";

const pythonProject = path.resolve(import.meta.dir, "../../python");

test("Pynect client loads and reuses the published catalog cache", async () => {
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "dbx-model-catalog-node-client-"),
  );
  const cacheDirectory = path.join(temporaryDirectory, "cache");
  const catalogPath = path.join(temporaryDirectory, "catalog.json.br");
  const catalog = {
    schema_version: 12,
    updated_at: "2026-11-03T12:00:00Z",
    models: {
      "databricks-gpt-test": {
        name: "GPT Test",
        description: "Published test model",
        aliases: ["gpt-test"],
        type: "chat",
        status: "active",
        modalities: { input: ["text"], output: ["text"] },
        capabilities: { tools: true, web_search: false },
        tasks: ["chat"],
        use_cases: [],
        availability: {},
        price: {},
        average_price: {},
        notices: [],
        rankings: [],
        benchmarks: [],
      },
    },
  };
  writeFileSync(
    catalogPath,
    brotliCompressSync(Buffer.from(JSON.stringify(catalog))),
  );

  try {
    await using python = new DbxModelCatalogPython({
      project: false,
      with: [],
      withEditable: [pythonProject],
    });
    const catalogModule = await python.client;
    const catalogUrl = pathToFileURL(catalogPath).href;
    const first = await catalogModule.NodeModelCatalogClient(
      null,
      false,
      catalogUrl,
      cacheDirectory,
    );

    expect(await first.get_schema_version()).toBe(12);
    expect(await first.get_size()).toBe(1);
    expect(await first.get_updated_at()).toStartWith("2026-11-03T12:00:00");
    expect(await first.query(
      { status: { $eq: "active" } },
      { limit: 1 },
    )).toHaveLength(1);
    await first.$release();

    rmSync(catalogPath);
    const cached = await catalogModule.NodeModelCatalogClient(
      null,
      false,
      catalogUrl,
      cacheDirectory,
    );
    expect(await cached.all()).toHaveLength(1);
    await cached.$release();
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}, 15_000);
