import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
  CatalogFilters,
  CatalogModelRecord,
  CatalogSearchIndexPayload,
  ModelCatalog,
} from "../src/browser.js";
import { filterCatalogRecords } from "../src/browser.js";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const catalogPath = fileURLToPath(new URL("../../web/catalog.json", import.meta.url));
const searchIndexPath = fileURLToPath(new URL("../../web/search-index.json", import.meta.url));
const pythonScript = fileURLToPath(new URL("./python_filter.py", import.meta.url));
const catalog = await Bun.file(catalogPath).json() as ModelCatalog;
const searchIndex = await Bun.file(searchIndexPath).json() as CatalogSearchIndexPayload;
const records: CatalogModelRecord[] = Object.entries(catalog.models).map(([id, model]) => ({
  ...model,
  id,
}));

const cases = [
  {},
  { limit: null },
  { status: ["active"], limit: 17 },
  { type: ["embedding"], limit: null },
  { publisher: ["Anthropic"], limit: null },
  { capability: ["reasoning"], limit: null },
  { capability: ["responses", "apply-patch"], limit: null },
  { capability: ["structured-output", "tools"], limit: null },
  { status: ["active"], type: ["chat"], publisher: ["OpenAI"], capability: ["tools"], limit: null },
  { task: ["not-present"], limit: null },
  { query: "gpt", limit: 10 },
  { query: "openai 6-1", limit: 10 },
  { query: "claud sonet", limit: 10 },
  { query: "reasoning tools", limit: 10 },
  { query: "embedding", type: ["embedding"], limit: null },
  { query: "vision", status: ["active"], capability: ["attachments"], limit: 12 },
] satisfies CatalogFilters[];

test("Node and Python filtering return identical records", async () => {
  const python = Bun.spawn(
    [
      "uv",
      "run",
      "--project",
      "packages/py/core",
      "python",
      pythonScript,
      catalogPath,
    ],
    {
      cwd: workspaceRoot,
      stderr: "inherit",
      stdin: "pipe",
      stdout: "pipe",
    },
  );
  python.stdin.write(JSON.stringify(cases));
  python.stdin.end();
  const output = await new Response(python.stdout).text();
  expect(await python.exited).toBe(0);

  const pythonResults = JSON.parse(output) as CatalogModelRecord[][];
  const nodeResults = cases.map(filters => filterCatalogRecords(records, searchIndex, filters));
  expect(nodeResults).toEqual(pythonResults);
}, 30_000);
