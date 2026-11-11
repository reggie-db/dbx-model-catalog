import { z } from "zod";
import {
  CATALOG_SEARCH_INDEX_JSON_SCHEMA,
  MODEL_CATALOG_JSON_SCHEMA,
} from "./_generated/json-schema.js";
import type { CatalogSearchIndexPayload, ModelCatalog } from "./_generated/schemas.js";

type JsonSchemaInput = Parameters<typeof z.fromJSONSchema>[0];
const modelCatalogSchema = z.fromJSONSchema(
  MODEL_CATALOG_JSON_SCHEMA as unknown as JsonSchemaInput,
);
const catalogSearchIndexSchema = z.fromJSONSchema(
  CATALOG_SEARCH_INDEX_JSON_SCHEMA as unknown as JsonSchemaInput,
);

/** Validate an untrusted catalog payload against the Python-owned contract. */
export function parseModelCatalog(value: unknown): ModelCatalog {
  return modelCatalogSchema.parse(value) as ModelCatalog;
}

/** Validate an untrusted search-index payload against the Python-owned contract. */
export function parseCatalogSearchIndex(value: unknown): CatalogSearchIndexPayload {
  return catalogSearchIndexSchema.parse(value) as CatalogSearchIndexPayload;
}
