import type { ClientOptions } from "@chanx-js/client";
import {
  createPynectClient,
  models,
  type CatalogFilters,
  type CatalogModelRecord,
  type CatalogSearchIndexPayload,
  type ModelCatalog,
} from "./_generated/index.js";

export type * from "./_generated/index.js";

export function createCatalogClient(options: ClientOptions) {
  const connection = createPynectClient(options).connect(models);

  return {
    async catalog(): Promise<ModelCatalog> {
      await connection.ready({ timeout: 10_000 });
      const response = await connection.request({
        action: "get_catalog",
        payload: {},
      });
      return response.payload;
    },

    async searchIndex(): Promise<CatalogSearchIndexPayload> {
      await connection.ready({ timeout: 10_000 });
      const response = await connection.request({
        action: "get_search_index",
        payload: {},
      });
      return response.payload;
    },

    async list(filters: CatalogFilters = {}): Promise<CatalogModelRecord[]> {
      await connection.ready({ timeout: 10_000 });
      const response = await connection.request({
        action: "list_models",
        payload: filters,
      });
      return response.payload;
    },

    async *stream(
      filters: CatalogFilters = {},
    ): AsyncGenerator<CatalogModelRecord> {
      await connection.ready({ timeout: 10_000 });
      const responses = connection.request({
        action: "stream_models",
        payload: filters,
      });
      for await (const response of responses) yield response.payload;
    },

    close(): void {
      connection.close();
    },
  };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;
