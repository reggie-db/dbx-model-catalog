import { z } from "zod";
import { JsonSyncClient } from "./client.ts";
import { flexibleDateSchema } from "./date.ts";

export const MODEL_PARAMS_URL = "https://modelparams.dev/api/v1/models.json";

const modelParamsScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const modelParamsConditionSchema = z.record(z.string(), z.unknown());

export const modelParamSchema = z.looseObject({
  path: z.string(),
  label: z.string(),
  description: z.string(),
  group: z.string(),
  type: z.string(),
  default: modelParamsScalarSchema.optional(),
  range: z
    .looseObject({
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().optional(),
    })
    .optional(),
  values: z.array(modelParamsScalarSchema).optional(),
  applicability: z
    .looseObject({
      only: modelParamsConditionSchema.optional(),
      except: z
        .union([modelParamsConditionSchema, z.array(modelParamsConditionSchema)])
        .optional(),
    })
    .optional(),
});

export const modelParamsModelSchema = z.looseObject({
  provider: z.string(),
  authType: z.string(),
  apiSurface: z.string(),
  model: z.string(),
  status: z.string().optional(),
  replacement: z.string().optional(),
  shutdownOn: flexibleDateSchema.optional(),
  wireId: z.string().optional(),
  params: z.array(modelParamSchema),
});

export const modelParamsSchema = z.looseObject({
  $schema: z.string(),
  generatedAt: flexibleDateSchema,
  count: z.number().int().nonnegative(),
  models: z.array(modelParamsModelSchema),
});

export type ModelParam = z.infer<typeof modelParamSchema>;
export type ModelParamsModel = z.infer<typeof modelParamsModelSchema>;
export type ModelParamsData = z.infer<typeof modelParamsSchema>;

export class ModelParamsSyncClient extends JsonSyncClient<ModelParamsData> {
  protected readonly schema = modelParamsSchema;
  protected readonly url = MODEL_PARAMS_URL;
}
