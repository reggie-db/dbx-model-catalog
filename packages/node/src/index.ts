import {
  DbxModelCatalogPython as GeneratedDbxModelCatalogPython,
  type DbxModelCatalogPythonModules,
} from "./generated/dbx-model-catalog-python.js";
import type { CreateVenvOptions } from "pynect";

const runtimeEnvironment = {
  UV_ASTRAL_MIRROR_URL: "https://releases.astral.sh",
  UV_PYTHON_INSTALL_MIRROR:
    "https://releases.astral.sh/github/python-build-standalone/releases/download",
} as const;

export type { DbxModelCatalogPythonModules };

export class DbxModelCatalogPython extends GeneratedDbxModelCatalogPython {
  constructor(options: CreateVenvOptions = {}) {
    super({
      ...options,
      env: { ...runtimeEnvironment, ...options.env },
    });
  }
}

export { kwargs, type CreateVenvOptions } from "pynect";
