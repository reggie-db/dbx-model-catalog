import { z } from "zod";
import {
  CATALOG_SEARCH_INDEX_JSON_SCHEMA,
  MODEL_CATALOG_JSON_SCHEMA,
} from "./_generated/json-schema.js";
import type {
  AveragePrice,
  Capabilities,
  CatalogModel,
  CatalogModelRecord,
  CatalogSearchIndexPayload,
  Latency,
  ModelCatalog,
  Price,
  Rankings,
  Rankings1,
  RateLimits,
  Status,
} from "./_generated/schemas.js";

type JsonSchemaInput = Parameters<typeof z.fromJSONSchema>[0];
type ModelCatalogDefinition = keyof typeof MODEL_CATALOG_JSON_SCHEMA.$defs;

function modelCatalogDefinitionSchema<T>(definition: ModelCatalogDefinition): z.ZodType<T> {
  return z.fromJSONSchema({
    ...MODEL_CATALOG_JSON_SCHEMA.$defs[definition],
    $defs: MODEL_CATALOG_JSON_SCHEMA.$defs,
  } as unknown as JsonSchemaInput) as z.ZodType<T>;
}

/** Runtime schema for the complete published model catalog. */
export const ModelCatalogSchema = z.fromJSONSchema(
  MODEL_CATALOG_JSON_SCHEMA as unknown as JsonSchemaInput,
) as z.ZodType<ModelCatalog>;

/** Runtime schema for the published catalog search index. */
export const CatalogSearchIndexSchema = z.fromJSONSchema(
  CATALOG_SEARCH_INDEX_JSON_SCHEMA as unknown as JsonSchemaInput,
) as z.ZodType<CatalogSearchIndexPayload>;

/** Runtime schema for one catalog model without its map key. */
export const CatalogModelSchema = modelCatalogDefinitionSchema<CatalogModel>("CatalogModel");

/** Runtime schema for one catalog model with its stable id. */
export const CatalogModelRecordSchema =
  modelCatalogDefinitionSchema<CatalogModelRecord>("CatalogModelRecord");

/** Runtime schema for catalog-owned model capabilities. */
export const CatalogCapabilitiesSchema =
  modelCatalogDefinitionSchema<Capabilities>("Capabilities");

/** Runtime schema for catalog-owned pay-per-token rate limits. */
export const CatalogRateLimitsSchema = modelCatalogDefinitionSchema<RateLimits>("RateLimits");

/** Runtime schema for catalog-owned latency measurements and score. */
export const CatalogLatencySchema = modelCatalogDefinitionSchema<Latency>("Latency");

/** Runtime schema for one catalog-owned cloud and currency price. */
export const CatalogPriceSchema = modelCatalogDefinitionSchema<Price>("Price");

/** Runtime schema for one catalog-owned normalized currency price. */
export const CatalogAveragePriceSchema =
  modelCatalogDefinitionSchema<AveragePrice>("AveragePrice");

/** Runtime schema for a preference-rating ranking. */
export const CatalogPreferenceRankingSchema =
  modelCatalogDefinitionSchema<Rankings>("Rankings");

/** Runtime schema for a scored-evaluation ranking. */
export const CatalogScoreRankingSchema = modelCatalogDefinitionSchema<Rankings1>("Rankings1");

/** Runtime schema for either catalog ranking representation. */
export const CatalogRankingSchema = z.union([
  CatalogPreferenceRankingSchema,
  CatalogScoreRankingSchema,
]);

/** Runtime schema for a catalog model lifecycle status. */
export const CatalogStatusSchema = modelCatalogDefinitionSchema<Status>("Status");

/** Validate an untrusted catalog payload against the Python-owned contract. */
export function parseModelCatalog(value: unknown): ModelCatalog {
  return ModelCatalogSchema.parse(value);
}

/** Validate an untrusted search-index payload against the Python-owned contract. */
export function parseCatalogSearchIndex(value: unknown): CatalogSearchIndexPayload {
  return CatalogSearchIndexSchema.parse(value);
}

/** Validate one untrusted catalog model record. */
export function parseCatalogModelRecord(value: unknown): CatalogModelRecord {
  return CatalogModelRecordSchema.parse(value);
}
