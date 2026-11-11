import type { ClientOptions } from "@chanx-js/client";
import { createPynectClient } from "pynect";
import { models } from "./_generated/channels.js";
import type {
  CatalogFilters,
  CatalogModelRecord,
  CatalogSearchIndexPayload,
  ModelCatalog,
} from "./_generated/schemas.js";
import type { CatalogClient } from "./types.js";
import { createModelCatalogIndex, type ModelCatalogIndex } from "./catalog-index.js";

export function createPynectCatalogClient(options: ClientOptions): CatalogClient {
  const connection = createPynectClient(options).connect(models);
  const requestCatalog = async (): Promise<ModelCatalog> => {
    await connection.ready({ timeout: 10_000 });
    return (await connection.request({ action: "get_catalog", payload: {} })).payload;
  };
  const requestSearchIndex = async (): Promise<CatalogSearchIndexPayload> => {
    await connection.ready({ timeout: 10_000 });
    return (await connection.request({ action: "get_search_index", payload: {} })).payload;
  };
  let index: Promise<ModelCatalogIndex> | undefined;
  const catalogIndex = (): Promise<ModelCatalogIndex> => {
    index ??= Promise.all([
      requestCatalog(),
      requestSearchIndex(),
    ]).then(([catalog, searchIndex]) => createModelCatalogIndex(catalog, searchIndex));
    return index;
  };
  return {
    async catalog(): Promise<ModelCatalog> {
      return requestCatalog();
    },

    async searchIndex(): Promise<CatalogSearchIndexPayload> {
      return requestSearchIndex();
    },

    async list(filters: CatalogFilters = {}): Promise<CatalogModelRecord[]> {
      await connection.ready({ timeout: 10_000 });
      return (await connection.request({ action: "list_models", payload: filters })).payload;
    },

    async get(identity: string): Promise<CatalogModelRecord | undefined> {
      return (await catalogIndex()).resolve(identity)?.record;
    },

    async resolve(identity: string) {
      return (await catalogIndex()).resolve(identity);
    },

    async search(query: string, limit: number | null = 50) {
      return (await catalogIndex()).search(query, limit);
    },

    async *stream(filters: CatalogFilters = {}): AsyncGenerator<CatalogModelRecord> {
      await connection.ready({ timeout: 10_000 });
      for await (const response of connection.request({ action: "stream_models", payload: filters })) {
        yield response.payload;
      }
    },

    close(): void {
      connection.close();
    },
  };
}
