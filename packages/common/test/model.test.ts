import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  CloudProviderSchema,
  ModelCatalogSchema,
  ModelStatusSchema,
  ModelTypeSchema,
  PriceCurrencySchema,
  PriceUnitSchema,
  RankingMetricSchema,
  ReasoningEffortSchema,
  ReasoningModeSchema,
} from "../src/model.ts";

describe("ModelCatalogSchema documentation", () => {
  test("documents every generated JSON Schema property", () => {
    const jsonSchema = z.toJSONSchema(ModelCatalogSchema);

    expect(jsonSchema.description).toBeTruthy();
    expect(undocumentedProperties(jsonSchema)).toEqual([]);
  });

  test("publishes catalog-owned vocabularies as JSON Schema enums", () => {
    expect(z.toJSONSchema(CloudProviderSchema).enum).toEqual([
      "aws",
      "azure",
      "gcp",
    ]);
    expect(z.toJSONSchema(ModelTypeSchema).enum).toContain("chat");
    expect(z.toJSONSchema(ModelTypeSchema).enum).toContain("embedding");
    expect(z.toJSONSchema(ModelStatusSchema).enum).toEqual([
      "active",
      "preview",
      "alpha",
      "beta",
      "legacy",
      "deprecated",
      "retired",
    ]);
    expect(z.toJSONSchema(PriceCurrencySchema).enum).toEqual([
      "DBU",
      "USD",
    ]);
    expect(z.toJSONSchema(PriceUnitSchema).enum).toEqual([
      "per_million_tokens",
      "per_hour",
      "per_hour_per_50_model_units",
    ]);
    expect(z.toJSONSchema(RankingMetricSchema).enum).toEqual([
      "rating",
      "score",
    ]);
    expect(z.toJSONSchema(ReasoningEffortSchema).enum).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "default",
    ]);
    expect(z.toJSONSchema(ReasoningModeSchema).enum).toEqual([
      "auto",
      "thinking",
    ]);
  });
});

function undocumentedProperties(value: unknown, path = "$root"): string[] {
  if (!isRecord(value)) return [];

  const missing: string[] = [];
  const properties = value.properties;
  if (isRecord(properties)) {
    for (const [name, property] of Object.entries(properties)) {
      const propertyPath = `${path}.${name}`;
      if (
        !isRecord(property) ||
        typeof property.description !== "string" ||
        property.description.trim().length === 0
      ) {
        missing.push(propertyPath);
      }
      missing.push(...undocumentedProperties(property, propertyPath));
    }
  }

  for (const key of ["items", "additionalProperties"] as const) {
    missing.push(...undocumentedProperties(value[key], `${path}.${key}`));
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = value[key];
    if (!Array.isArray(variants)) continue;
    variants.forEach((variant, index) => {
      missing.push(
        ...undocumentedProperties(variant, `${path}.${key}[${index}]`),
      );
    });
  }
  if (isRecord(value.$defs)) {
    for (const [name, definition] of Object.entries(value.$defs)) {
      missing.push(
        ...undocumentedProperties(definition, `${path}.$defs.${name}`),
      );
    }
  }

  return missing;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
