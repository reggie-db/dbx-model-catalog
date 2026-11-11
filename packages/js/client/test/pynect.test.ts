import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createPynectCatalogClient } from "../src/pynect.js";

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const catalogPath = fileURLToPath(new URL("../../web/catalog.json", import.meta.url));

test("Pynect demo client connects to the Python server", async () => {
  const reservation = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 503 }),
  });
  const port = reservation.port;
  await reservation.stop(true);
  if (port === undefined) throw new Error("Could not reserve a demo server port");
  const server = Bun.spawn(
    [
      "uv",
      "run",
      "--project",
      "packages/py/server",
      "uvicorn",
      "dbx_model_catalog_server.app:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: workspaceRoot,
      env: { ...process.env, DBX_MODEL_CATALOG_PATH: catalogPath },
      stderr: "ignore",
      stdout: "ignore",
    },
  );

  try {
    await waitForHealth(port, server);
    const client = createPynectCatalogClient({ baseUrl: `ws://127.0.0.1:${port}` });
    try {
      const models = await client.list({ query: "gpt", limit: 2 });
      expect(models.map(model => model.id)).toEqual([
        "databricks-gpt-6-1-sol",
        "databricks-gpt-5-5",
      ]);
    } finally {
      client.close();
    }
  } finally {
    server.kill("SIGTERM");
    await server.exited;
  }
}, 30_000);

async function waitForHealth(port: number, server: ReturnType<typeof Bun.spawn>): Promise<void> {
  const healthUrl = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Python server exited with ${server.exitCode}`);
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(50);
  }
  throw new Error(`Python server did not become ready at ${healthUrl}`);
}
