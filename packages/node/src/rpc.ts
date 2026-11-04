import { treaty, type Treaty } from "@elysiajs/eden";
import type { CatalogRpcApp } from "./server/app.js";
import type { CatalogModel } from "./generated/catalog-types.js";

export type * from "./generated/catalog-types.js";
export type CatalogModelRecord = CatalogModel & { readonly id: string };
export type CatalogRpcClient = Treaty.Create<CatalogRpcApp, {}>;

export function createCatalogRpcClient(baseUrl?: string): CatalogRpcClient {
  const origin = baseUrl ?? (
    typeof window === "undefined" ? "http://127.0.0.1:8000" : window.location.origin
  );
  return treaty<CatalogRpcApp>(origin, { parseDate: false });
}
