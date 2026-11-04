import {
  connectVenv,
  type ConnectWebSocketVenvOptions,
  type WebSocketVenv,
} from "pynect/websocket";
import type {
  ClientModule,
  DbxModelCatalogPythonModules,
  TypesModule,
} from "./generated/dbx-model-catalog-python.js";
import { CATALOG_PYNECT_PATH } from "./contract.js";

export type * from "./generated/catalog-types.js";
export type {
  ClientModule,
  DbxModelCatalogPythonModules,
  NodeModelCatalogClient,
  TypesModule,
} from "./generated/dbx-model-catalog-python.js";

export interface DbxModelCatalogWebSocketOptions extends
  Omit<ConnectWebSocketVenvOptions, "url"> {
  readonly baseUrl?: string | URL;
}

/** Browser-safe Pynect binding with the same generated modules as local IPC. */
export class DbxModelCatalogWebSocket implements AsyncDisposable {
  readonly venv: WebSocketVenv<DbxModelCatalogPythonModules>;

  constructor(options: DbxModelCatalogWebSocketOptions = {}) {
    const { baseUrl, ...pynect } = options;
    this.venv = connectVenv<DbxModelCatalogPythonModules>({
      ...pynect,
      url: catalogWebSocketUrl(baseUrl),
    });
  }

  get client(): Promise<ClientModule> {
    return this.venv.import("client");
  }

  get types(): Promise<TypesModule> {
    return this.venv.import("types");
  }

  close(): Promise<void> {
    return this.venv.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export function catalogWebSocketUrl(baseUrl?: string | URL): URL {
  const origin = baseUrl ?? (
    typeof window === "undefined" ? "http://127.0.0.1:8000" : window.location.origin
  );
  const url = new URL(CATALOG_PYNECT_PATH, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}
