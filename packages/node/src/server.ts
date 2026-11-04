#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startCatalogServer } from "./server/app.js";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = resolve(packageRoot, "../..");
const siteDirectory = process.env.DBX_MODEL_CATALOG_SITE_DIR ?? resolve(workspaceRoot, "site/dist");
const defaultPythonProject = resolve(workspaceRoot, "packages/python");
const configuredPythonProject = process.env.DBX_MODEL_CATALOG_PYTHON_PROJECT;
const pythonProject = configuredPythonProject ?? (
  existsSync(resolve(defaultPythonProject, "pyproject.toml")) ? defaultPythonProject : undefined
);
const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? process.env.DATABRICKS_APP_PORT ?? 8000);

const app = await startCatalogServer({
  hostname,
  port,
  ...(pythonProject
    ? { python: { project: false, with: [], withEditable: [pythonProject] } }
    : {}),
  siteDirectory,
});

console.log(`dbx-model-catalog listening on ${app.url.href}`);

export { app };
