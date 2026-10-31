import { resolve } from "node:path";
import { z } from "zod";
import { CatalogModelSchema, ModelCatalogSchema } from "./model.ts";

const outputPath = Bun.argv[2];
if (!outputPath) {
  throw new Error("Usage: schema-cli.ts <output-path>");
}

const schema = structuredClone(
  z.toJSONSchema(ModelCatalogSchema),
) as JsonSchemaObject;
const catalogModelSchema = structuredClone(
  z.toJSONSchema(CatalogModelSchema),
) as JsonSchemaObject;

delete catalogModelSchema.$schema;
catalogModelSchema.title = "CatalogModel";
schema.title = "ModelCatalog";
schema.$defs = { CatalogModel: catalogModelSchema };

const models = schema.properties?.models;
if (!models || typeof models !== "object") {
  throw new Error("Model catalog schema does not define models.");
}
models.additionalProperties = { $ref: "#/$defs/CatalogModel" };

await Bun.write(resolve(outputPath), `${JSON.stringify(schema, null, 2)}\n`);

interface JsonSchemaObject {
  $schema?: string;
  $defs?: Record<string, JsonSchemaObject>;
  $ref?: string;
  title?: string;
  properties?: Record<string, JsonSchemaObject>;
  additionalProperties?: boolean | JsonSchemaObject;
}
