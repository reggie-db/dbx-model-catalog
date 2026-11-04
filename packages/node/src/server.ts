#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogRpcApp } from "./server/app.js";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = resolve(packageRoot, "../..");
const siteDirectory = process.env.DBX_MODEL_CATALOG_SITE_DIR ?? resolve(workspaceRoot, "site/dist");
const pythonProject = process.env.DBX_MODEL_CATALOG_PYTHON_PROJECT ?? resolve(workspaceRoot, "packages/python");
const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? process.env.DATABRICKS_APP_PORT ?? 8000);

const app = createCatalogRpcApp({
  catalogPath: resolve(siteDirectory, "catalog.json"),
  python: { project: pythonProject, with: [] },
  siteDirectory,
});

app.listen({ hostname, port });
console.log(`dbx-model-catalog listening on http://${hostname}:${port}`);

export { app };
