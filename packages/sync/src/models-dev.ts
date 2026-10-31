import { z } from "zod";
import { JsonSyncClient } from "./client.ts";
import { flexibleDateSchema } from "./date.ts";

export const MODELS_DEV_URL = "https://models.dev/api.json";

const modelsDevCostRateShape = {
  input: z.number().optional(),
  output: z.number().optional(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
  reasoning: z.number().optional(),
  input_audio: z.number().optional(),
  output_audio: z.number().optional(),
};

const modelsDevCostTierSchema = z.looseObject({
  ...modelsDevCostRateShape,
  tier: z.looseObject({
    type: z.string(),
    size: z.number().optional(),
  }),
});

const modelsDevCostSchema = z.looseObject({
  ...modelsDevCostRateShape,
  tiers: z.array(modelsDevCostTierSchema).optional(),
  context_over_200k: z.looseObject(modelsDevCostRateShape).optional(),
});

const modelsDevReasoningOptionSchema = z.looseObject({
  type: z.string(),
  values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const modelsDevProviderOverrideSchema = z.looseObject({
  npm: z.string().optional(),
  api: z.string().optional(),
  shape: z.string().optional(),
});

const modelsDevExperimentalModeSchema = z.looseObject({
  cost: z.looseObject(modelsDevCostRateShape).optional(),
  provider: z
    .looseObject({
      body: z.record(z.string(), z.unknown()).optional(),
      headers: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export const modelsDevModelSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  family: z.string().optional(),
  attachment: z.boolean(),
  reasoning: z.boolean(),
  reasoning_options: z.array(modelsDevReasoningOptionSchema).optional(),
  tool_call: z.boolean(),
  interleaved: z
    .union([
      z.boolean(),
      z.looseObject({
        field: z.string(),
      }),
    ])
    .optional(),
  structured_output: z.boolean().optional(),
  temperature: z.boolean().optional(),
  knowledge: flexibleDateSchema.optional(),
  release_date: flexibleDateSchema,
  last_updated: flexibleDateSchema,
  modalities: z.looseObject({
    input: z.array(z.string()),
    output: z.array(z.string()),
  }),
  open_weights: z.boolean(),
  limit: z.looseObject({
    context: z.number(),
    output: z.number(),
    input: z.number().optional(),
  }),
  cost: modelsDevCostSchema.optional(),
  canonical_model_id: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  provider: modelsDevProviderOverrideSchema.optional(),
  experimental: z
    .looseObject({
      modes: z.record(z.string(), modelsDevExperimentalModeSchema),
    })
    .optional(),
});

export const modelsDevProviderSchema = z.looseObject({
  id: z.string(),
  env: z.array(z.string()),
  npm: z.string(),
  api: z.string().optional(),
  name: z.string(),
  doc: z.string(),
  models: z.record(z.string(), modelsDevModelSchema),
});

export const modelsDevSchema = z.record(
  z.string(),
  modelsDevProviderSchema,
);

export type ModelsDevModel = z.infer<typeof modelsDevModelSchema>;
export type ModelsDevProvider = z.infer<typeof modelsDevProviderSchema>;
export type ModelsDevData = z.infer<typeof modelsDevSchema>;

export class ModelsDevSyncClient extends JsonSyncClient<ModelsDevData> {
  protected readonly schema = modelsDevSchema;
  protected readonly url = MODELS_DEV_URL;
}
