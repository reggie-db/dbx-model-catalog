import { z } from "zod";

export const MODEL_CATALOG_SCHEMA_VERSION = 11 as const;

export const CloudProvider = {
  Aws: "aws",
  Azure: "azure",
  Gcp: "gcp",
} as const;

export const CloudProviderSchema = z
  .enum([CloudProvider.Aws, CloudProvider.Azure, CloudProvider.Gcp])
  .describe("Cloud provider where Databricks serves the model.");

export const ModelType = {
  Chat: "chat",
  Image: "image",
  Video: "video",
  Embedding: "embedding",
  Reranking: "reranking",
  Decision: "decision",
  Transcription: "transcription",
  Speech: "speech",
  Realtime: "realtime",
  Extraction: "extraction",
  Audio: "audio",
} as const;

export const ModelTypeSchema = z
  .enum([
    ModelType.Chat,
    ModelType.Image,
    ModelType.Video,
    ModelType.Embedding,
    ModelType.Reranking,
    ModelType.Decision,
    ModelType.Transcription,
    ModelType.Speech,
    ModelType.Realtime,
    ModelType.Extraction,
    ModelType.Audio,
  ])
  .describe("Normalized model type.");

export const ModelStatus = {
  Active: "active",
  Preview: "preview",
  Alpha: "alpha",
  Beta: "beta",
  Legacy: "legacy",
  Deprecated: "deprecated",
  Retired: "retired",
} as const;

export const ModelStatusSchema = z
  .enum([
    ModelStatus.Active,
    ModelStatus.Preview,
    ModelStatus.Alpha,
    ModelStatus.Beta,
    ModelStatus.Legacy,
    ModelStatus.Deprecated,
    ModelStatus.Retired,
  ])
  .describe("Current normalized model lifecycle state.");

export const ModelModality = {
  Text: "text",
  Image: "image",
  Audio: "audio",
  Video: "video",
  Pdf: "application/pdf",
  Embedding: "embedding",
  Reranking: "reranking",
  Decision: "decision",
} as const;

export const KnownModelModalitySchema = z
  .enum([
    ModelModality.Text,
    ModelModality.Image,
    ModelModality.Audio,
    ModelModality.Video,
    ModelModality.Pdf,
    ModelModality.Embedding,
    ModelModality.Reranking,
    ModelModality.Decision,
  ])
  .describe("Known model input and output modalities.");

const MimeTypeSchema = z
  .string()
  .regex(/^(text|image|audio|video|application)\/[A-Za-z0-9.+-]+$/)
  .describe("Valid media MIME type.");

export const ModelModalitySchema = z
  .union([KnownModelModalitySchema, MimeTypeSchema])
  .describe("Model input or output modality.");

export const ReasoningEffort = {
  None: "none",
  Minimal: "minimal",
  Low: "low",
  Medium: "medium",
  High: "high",
  XHigh: "xhigh",
  Max: "max",
  Default: "default",
} as const;

export const ReasoningEffortSchema = z
  .enum([
    ReasoningEffort.None,
    ReasoningEffort.Minimal,
    ReasoningEffort.Low,
    ReasoningEffort.Medium,
    ReasoningEffort.High,
    ReasoningEffort.XHigh,
    ReasoningEffort.Max,
    ReasoningEffort.Default,
  ])
  .describe("Normalized reasoning effort level.");

export const ReasoningMode = {
  Auto: "auto",
  Thinking: "thinking",
} as const;

export const ReasoningModeSchema = z
  .enum([ReasoningMode.Auto, ReasoningMode.Thinking])
  .describe("Reasoning execution mode used by an evaluated model variant.");

export const ServingMode = {
  PayPerToken: "pay_per_token",
  PriorityPayPerToken: "priority_pay_per_token",
  ProvisionedThroughput: "provisioned_throughput",
  Batch: "batch",
} as const;

export const ServingModeSchema = z
  .enum([
    ServingMode.PayPerToken,
    ServingMode.PriorityPayPerToken,
    ServingMode.ProvisionedThroughput,
    ServingMode.Batch,
  ])
  .describe("Databricks serving mode available for the model.");

export const PriceCurrency = {
  Dbu: "DBU",
  Usd: "USD",
} as const;

export const PriceCurrencySchema = z
  .enum([PriceCurrency.Dbu, PriceCurrency.Usd])
  .describe("Currency or Databricks billing unit used by a price.");

export const PriceUnit = {
  MillionTokens: "per_million_tokens",
  Hour: "per_hour",
  HourPer50ModelUnits: "per_hour_per_50_model_units",
} as const;

export const PriceUnitSchema = z
  .enum([
    PriceUnit.MillionTokens,
    PriceUnit.Hour,
    PriceUnit.HourPer50ModelUnits,
  ])
  .describe("Quantity to which each price rate applies.");

export const RankingMetric = {
  Rating: "rating",
  Score: "score",
} as const;

export const RankingMetricSchema = z
  .enum([RankingMetric.Rating, RankingMetric.Score])
  .describe("Metric used to rank the model.");

export const KnownNoticeKind = {
  Note: "note",
  Important: "important",
  Warning: "warning",
  Tip: "tip",
  Caution: "caution",
  Info: "info",
} as const;

export const KnownNoticeKindSchema = z
  .enum([
    KnownNoticeKind.Note,
    KnownNoticeKind.Important,
    KnownNoticeKind.Warning,
    KnownNoticeKind.Tip,
    KnownNoticeKind.Caution,
    KnownNoticeKind.Info,
  ])
  .describe("Known Databricks documentation notice kinds.");

export const NoticeKindSchema = z
  .union([KnownNoticeKindSchema, z.string().min(1)])
  .describe("Documentation notice kind; unknown future kinds remain valid.");

export const CatalogDateSchema = z
  .iso.date()
  .describe("ISO 8601 calendar date in YYYY-MM-DD format.");

export const CatalogTimestampSchema = z
  .iso.datetime({ offset: true })
  .describe("ISO 8601 date-time with a UTC offset.");

export const CatalogModelIdSchema = z
  .string()
  .min(1)
  .describe(
    "Databricks serving endpoint or model service identifier used as the catalog key.",
  );

export const ModelModalitiesSchema = z
  .object({
    input: z
      .array(ModelModalitySchema)
      .describe("Modalities accepted by the model."),
    output: z
      .array(ModelModalitySchema)
      .describe("Modalities produced by the model."),
  })
  .strict()
  .describe("Model input and output modalities.");

export const ReasoningBudgetSchema = z
  .object({
    min: z
      .number()
      .int()
      .optional()
      .describe("Minimum supported reasoning-token budget."),
    max: z
      .number()
      .int()
      .optional()
      .describe("Maximum supported reasoning-token budget."),
  })
  .strict()
  .describe("Supported reasoning-token budget range.");

export const ModelReasoningSchema = z
  .discriminatedUnion("supported", [
    z
      .object({
        supported: z
          .literal(false)
          .describe("The model does not support explicit reasoning controls."),
      })
      .strict(),
    z
      .object({
        supported: z
          .literal(true)
          .describe("The model supports explicit reasoning controls."),
        effort: z
          .array(ReasoningEffortSchema)
          .optional()
          .describe("Supported reasoning effort levels."),
        default_effort: ReasoningEffortSchema.optional().describe(
          "Default reasoning effort when no level is specified.",
        ),
        toggle: z
          .boolean()
          .optional()
          .describe("Whether reasoning can be explicitly enabled or disabled."),
        budget: ReasoningBudgetSchema.optional().describe(
          "Supported reasoning-token budget range.",
        ),
        description: z
          .string()
          .optional()
          .describe("Combined Databricks description of reasoning behavior."),
      })
      .strict(),
  ])
  .describe("Reasoning support and available reasoning controls.");

export const ModelCapabilitiesSchema = z
  .object({
    attachments: z
      .boolean()
      .optional()
      .describe("Whether requests can include image, audio, video, or PDF attachments."),
    tools: z
      .boolean()
      .optional()
      .describe("Whether the model supports tool or function calling."),
    structured_output: z
      .boolean()
      .optional()
      .describe("Whether the model supports schema-constrained output."),
    temperature: z
      .boolean()
      .optional()
      .describe("Whether the model supports temperature sampling."),
    interleaved_reasoning: z
      .boolean()
      .optional()
      .describe("Whether reasoning content can be interleaved with the answer."),
    web_search: z
      .boolean()
      .describe("Whether Databricks documents native web search support."),
    reasoning: ModelReasoningSchema.optional().describe(
      "Reasoning support and controls when known.",
    ),
  })
  .strict()
  .describe("Capabilities used to select a model for a workload.");

export const ModelLimitsSchema = z
  .object({
    context: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Maximum context window in tokens."),
    input: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Maximum input length in tokens."),
    output: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("Maximum generated output length in tokens."),
  })
  .strict()
  .describe("Documented token limits.");

export const ModelAvailabilitySchema = z
  .object({
    status: ModelStatusSchema.describe(
      "Lifecycle state for this cloud-provider deployment.",
    ),
    serving_modes: z
      .array(ServingModeSchema)
      .describe("Serving modes documented or priced for this deployment."),
    details: z
      .string()
      .optional()
      .describe("Additional Databricks availability details."),
  })
  .strict()
  .describe("Model availability on one Databricks cloud provider.");

export const ModelAvailabilityByCloudSchema = z
  .partialRecord(CloudProviderSchema, ModelAvailabilitySchema)
  .describe("Model availability keyed by Databricks cloud provider.");

export const ModelPriceRatesSchema = z
  .record(
    z
      .string()
      .min(1)
      .describe("Billing dimension such as input, output, cache_read, or hour."),
    z.number().nonnegative(),
  )
  .describe("Price rates keyed by billing dimension.");

export const ModelPriceSchema = z
  .object({
    unit: PriceUnitSchema.describe("Quantity to which the rates apply."),
    rates: ModelPriceRatesSchema.describe(
      "Rates keyed by billing dimension.",
    ),
  })
  .strict()
  .describe("Normalized Databricks price in one currency.");

export const ModelPriceSummarySchema = z
  .partialRecord(PriceCurrencySchema, ModelPriceSchema)
  .describe("Available DBU and USD prices.");

export const ModelPriceByCloudSchema = z
  .partialRecord(CloudProviderSchema, ModelPriceSummarySchema)
  .describe(
    "Average Databricks prices for each cloud provider across matched serving modes and pricing conditions.",
  );

export const RetirementScheduleSchema = z
  .object({
    offering: z
      .string()
      .describe("Serving offering affected by this retirement schedule."),
    dates: z
      .array(CatalogDateSchema)
      .describe("Retirement dates documented for the offering."),
  })
  .strict()
  .describe("Retirement dates for one serving offering.");

export const ModelRetirementSchema = z
  .object({
    schedules: z
      .array(RetirementScheduleSchema)
      .describe("Retirement schedules by serving offering."),
    replacement: CatalogModelIdSchema.optional().describe(
      "Catalog key of the recommended replacement model when matched.",
    ),
    replacement_name: z
      .string()
      .optional()
      .describe("Documented replacement model name when no catalog key is matched."),
  })
  .strict()
  .describe("Databricks retirement and replacement information.");

export const ModelNoticeSchema = z
  .object({
    kind: NoticeKindSchema.describe("Documentation notice kind."),
    title: z
      .string()
      .optional()
      .describe("Notice title when it adds information beyond the kind."),
    text: z.string().describe("Deduplicated notice text."),
  })
  .strict()
  .describe("Important Databricks documentation notice.");

export const EvaluationVariantSchema = z
  .object({
    reasoning: z
      .boolean()
      .optional()
      .describe("Whether the evaluated variant used reasoning."),
    reasoning_effort: ReasoningEffortSchema.optional().describe(
      "Reasoning effort used by the evaluated variant.",
    ),
    reasoning_mode: ReasoningModeSchema.optional().describe(
      "Reasoning execution mode used by the evaluated variant.",
    ),
    harness: z
      .string()
      .optional()
      .describe("Agent or evaluation harness used for the result."),
    context: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Context-window size used by the evaluated variant."),
  })
  .strict()
  .describe("Configuration that distinguishes an evaluated model variant.");

const RankingBaseShape = {
  domain: z.string().describe("Leaderboard domain or configuration."),
  category: z.string().describe("Leaderboard category within the domain."),
  rank: z.number().int().positive().describe("One-based leaderboard rank."),
  published_at: CatalogDateSchema.optional().describe(
    "Leaderboard publication date.",
  ),
  variant: EvaluationVariantSchema.optional().describe(
    "Evaluated model variant when it differs from the base model.",
  ),
};

export const RatingRankingSchema = z
  .object({
    ...RankingBaseShape,
    metric: z
      .literal(RankingMetric.Rating)
      .describe("This ranking uses a preference rating."),
    rating: z.number().describe("Central rating estimate."),
    lower: z.number().describe("Lower confidence bound."),
    upper: z.number().describe("Upper confidence bound."),
    variance: z.number().nonnegative().describe("Estimated rating variance."),
    votes: z
      .number()
      .int()
      .nonnegative()
      .describe("Human preference votes used for the rating."),
  })
  .strict()
  .describe("Competitive ranking based on human preference ratings.");

export const ScoreRankingSchema = z
  .object({
    ...RankingBaseShape,
    metric: z
      .literal(RankingMetric.Score)
      .describe("This ranking uses an evaluation score."),
    score: z.number().describe("Central score estimate."),
    lower: z.number().describe("Lower confidence bound."),
    upper: z.number().describe("Upper confidence bound."),
    observations: z
      .number()
      .int()
      .nonnegative()
      .describe("Observations used to estimate the score."),
    sessions: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe("Evaluation sessions, or null when not reported."),
  })
  .strict()
  .describe("Competitive ranking based on a scored evaluation.");

export const ModelRankingSchema = z
  .discriminatedUnion("metric", [RatingRankingSchema, ScoreRankingSchema])
  .describe("Competitive leaderboard ranking.");

export const ModelBenchmarkSchema = z
  .object({
    name: z.string().describe("Benchmark category or task-suite name."),
    rank: z.number().int().positive().describe("One-based benchmark rank."),
    score: z.number().describe("Benchmark score."),
    task_count: z
      .number()
      .int()
      .positive()
      .describe("Tasks represented by the benchmark score."),
    published_at: CatalogDateSchema.optional().describe(
      "Benchmark publication date.",
    ),
    variant: EvaluationVariantSchema.optional().describe(
      "Evaluated model variant when it differs from the base model.",
    ),
  })
  .strict()
  .describe("Task-suite benchmark result.");

export const CatalogModelSchema = z
  .object({
    name: z.string().describe("Canonical model name from Databricks documentation."),
    description: z
      .string()
      .describe("Consolidated description of the model and intended use."),
    aliases: z
      .array(z.string())
      .describe("Alternative names and identifiers; excludes the catalog key."),
    type: ModelTypeSchema.describe("Normalized model type."),
    family: z
      .string()
      .optional()
      .describe("Model family used to group related versions."),
    publisher: z
      .string()
      .optional()
      .describe("Organization that develops or publishes the model."),
    license: z
      .string()
      .optional()
      .describe("Model license or upstream license classification."),
    open_weights: z
      .boolean()
      .optional()
      .describe("Whether model weights are publicly available."),
    status: ModelStatusSchema.describe("Current normalized lifecycle state."),
    release_date: CatalogDateSchema.optional().describe("Model release date."),
    last_updated: CatalogDateSchema.optional().describe(
      "Latest known model revision or metadata date.",
    ),
    knowledge_cutoff: CatalogDateSchema.optional().describe(
      "Latest date covered by the model's stated training knowledge.",
    ),
    retirement: ModelRetirementSchema.optional().describe(
      "Databricks retirement and replacement information.",
    ),
    modalities: ModelModalitiesSchema.describe("Model input and output modalities."),
    capabilities: ModelCapabilitiesSchema.describe(
      "Capabilities used to select the model for a workload.",
    ),
    limits: ModelLimitsSchema.optional().describe("Documented token limits."),
    tasks: z
      .array(z.string())
      .describe("High-level tasks documented for the model."),
    use_cases: z
      .array(z.string())
      .describe("Example use cases documented for the model."),
    availability: ModelAvailabilityByCloudSchema.describe(
      "Availability keyed by Databricks cloud provider.",
    ),
    price: ModelPriceByCloudSchema.describe(
      "Average Databricks DBU and USD prices for each cloud provider.",
    ),
    average_price: ModelPriceSummarySchema.describe(
      "Average Databricks DBU and USD price across cloud providers and matched pricing variants.",
    ),
    notices: z
      .array(ModelNoticeSchema)
      .describe("Deduplicated Databricks documentation notices."),
    rankings: z
      .array(ModelRankingSchema)
      .describe("Competitive leaderboard rankings matched to the model."),
    benchmarks: z
      .array(ModelBenchmarkSchema)
      .describe("Task-suite benchmark results matched to the model."),
  })
  .strict()
  .describe("Published statistics for one Databricks model.");

export const ModelCatalogSchema = z
  .object({
    schema_version: z
      .literal(MODEL_CATALOG_SCHEMA_VERSION)
      .describe("Version of the published catalog contract."),
    updated_at: CatalogTimestampSchema.describe(
      "Latest source-fetch timestamp represented by the catalog.",
    ),
    models: z.record(CatalogModelIdSchema, CatalogModelSchema).describe(
      "Models keyed by Databricks serving endpoint or model service identifier.",
    ),
  })
  .strict()
  .describe(
    "Published Databricks model catalog with identity, capabilities, availability, pricing, lifecycle, rankings, and benchmarks.",
  );

export type CloudProvider = z.infer<typeof CloudProviderSchema>;
export type ModelReasoning = z.infer<typeof ModelReasoningSchema>;
export type ModelPriceSummary = z.infer<typeof ModelPriceSummarySchema>;
export type ModelPriceByCloud = z.infer<typeof ModelPriceByCloudSchema>;
export type ModelRanking = z.infer<typeof ModelRankingSchema>;
export type ModelBenchmark = z.infer<typeof ModelBenchmarkSchema>;
export type CatalogModel = z.infer<typeof CatalogModelSchema>;
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
