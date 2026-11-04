import {
  DbxModelCatalogPython as GeneratedDbxModelCatalogPython,
} from "./generated/dbx-model-catalog-python.js";
import type { CreateVenvOptions } from "pynect";
import { pythonRuntimeEnvironment } from "./runtime.js";

export type {
  ClientModule,
  DbxModelCatalogPythonModules,
  NodeCatalogSync,
  NodeModelCatalogClient,
} from "./generated/dbx-model-catalog-python.js";

export class DbxModelCatalogPython extends GeneratedDbxModelCatalogPython {
  constructor(options: CreateVenvOptions = {}) {
    super({
      ...options,
      env: pythonRuntimeEnvironment(options.env),
    });
  }
}

export { kwargs, type CreateVenvOptions } from "pynect";
