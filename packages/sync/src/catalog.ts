import {
  ModelModality,
  ModelStatus,
  ModelType,
  MODEL_CATALOG_SCHEMA_VERSION,
  ModelAvailabilityByCloudSchema,
  ModelCatalogSchema,
  ModelPriceSummarySchema,
  PriceCurrency,
  PriceUnit,
  RankingMetric,
  ReasoningEffort,
  ReasoningMode,
  ServingMode,
  type ModelBenchmark,
  type CatalogModel,
  type ModelCatalog,
  type ModelPriceByCloud,
  type ModelPriceSummary,
  type ModelRanking,
  type ModelReasoning,
  type SyncResult,
} from "@dbx-model-catalog/common";
import {
  DATABRICKS_CLOUD_PROVIDERS,
  type DatabricksCatalogData,
  type DatabricksCloudProvider,
} from "./databricks.ts";
import {
  type LMArenaCatalogData,
  type LMArenaRow,
} from "./lm-arena.ts";
import {
  type LiveBenchCatalogData,
  type LiveBenchRow,
} from "./livebench.ts";
import {
  type ModelParamsData,
  type ModelParamsModel,
} from "./modelparams.ts";
import {
  type ModelsDevData,
  type ModelsDevModel,
  type ModelsDevProvider,
} from "./models-dev.ts";

export interface CatalogSyncSources {
  readonly modelsDev: SyncResult<"models.dev", ModelsDevData>;
  readonly modelParams: SyncResult<"modelparams.dev", ModelParamsData>;
  readonly lmArena: SyncResult<"lm-arena", LMArenaCatalogData>;
  readonly liveBench: SyncResult<"livebench", LiveBenchCatalogData>;
  readonly databricks: SyncResult<"databricks", DatabricksCatalogData>;
}

type DatabricksSupportedModel =
  DatabricksCatalogData["cloudProviders"][DatabricksCloudProvider]["supportedModels"]["models"][number];

interface DatabricksModelGroup {
  readonly key: string;
  readonly representative: DatabricksSupportedModel;
  readonly deployments: Partial<
    Record<DatabricksCloudProvider, DatabricksSupportedModel>
  >;
}

interface ModelsDevRecord {
  readonly provider: ModelsDevProvider;
  readonly modelKey: string;
  readonly model: ModelsDevModel;
}

interface ArenaRecord {
  readonly configuration: string;
  readonly row: LMArenaRow;
}

interface LiveBenchRecord {
  readonly row: LiveBenchRow;
  readonly benchmarks: readonly ModelBenchmark[];
}

type RatingArenaRow = LMArenaRow & {
  readonly rating: number;
  readonly rating_lower: number;
  readonly rating_upper: number;
  readonly variance: number;
  readonly vote_count: number;
};

type ScoreArenaRow = LMArenaRow & {
  readonly score: number;
  readonly score_ci_lower: number;
  readonly score_ci_upper: number;
  readonly observation_count: number;
  readonly session_count: number | null;
};

interface ModelBuildContext {
  readonly group: DatabricksModelGroup;
  readonly id: string;
  readonly aliases: readonly string[];
  readonly primary?: ModelsDevRecord;
  readonly modelsDevRecords: readonly ModelsDevRecord[];
  readonly modelParams: readonly ModelParamsModel[];
  readonly arena: readonly ArenaRecord[];
  readonly liveBench: readonly LiveBenchRecord[];
}

interface CatalogPriceMeasureInput {
  readonly unit: string;
  readonly rates: Readonly<Record<string, number | null>>;
}

interface CatalogPriceInput {
  readonly cloudProvider?: DatabricksCloudProvider;
  readonly measures: Readonly<Record<string, CatalogPriceMeasureInput>>;
}

type CatalogModelStatus = CatalogModel["status"];
type CatalogModelType = CatalogModel["type"];
type CatalogModality = CatalogModel["modalities"]["input"][number];
type EvaluationVariant = NonNullable<ModelBenchmark["variant"]>;

const ARENA_VARIANT_SUFFIX =
  /\s*\([^)]*(?:harness|thinking|reasoning|\bxhigh\b|\bhigh\b|\bmedium\b|\blow\b)[^)]*\)\s*$/i;
const LIVEBENCH_VARIANT_SUFFIX =
  /(?:-(?:\d{8}|\d{4}-\d{2}-\d{2}))?(?:-(?:thinking|auto|\d+k|low|medium|high|xhigh|extra-high|effort))+$/i;

export function buildModelCatalog(sources: CatalogSyncSources): ModelCatalog {
  const groups = databricksModelGroups(sources.databricks.data);
  const modelsDevRecords = flattenModelsDev(sources.modelsDev.data);
  const arenaRecords = flattenArena(sources.lmArena.data);
  const liveBenchRecords = flattenLiveBench(sources.liveBench.data);
  const contexts = groups.map((group) =>
    buildContext(
      group,
      modelsDevRecords,
      sources.modelParams.data.models,
      arenaRecords,
      liveBenchRecords,
    ),
  );
  const models = Object.fromEntries(
    contexts.map((context) => [
      context.id,
      buildCatalogModel(context, contexts, sources),
    ]),
  );

  return ModelCatalogSchema.parse({
    schema_version: MODEL_CATALOG_SCHEMA_VERSION,
    updated_at: latestFetchedAt(sources),
    models,
  });
}

export function normalizeModelIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^system\.ai[.-]/, "")
    .replace(/^databricks-/, "")
    .replace(/([a-z])(\d)/g, "$1-$2")
    .replace(/(\d)([a-z])/g, "$1-$2")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function databricksModelGroups(data: DatabricksCatalogData): DatabricksModelGroup[] {
  const groups = new Map<string, DatabricksModelGroup>();
  for (const cloudProvider of DATABRICKS_CLOUD_PROVIDERS) {
    for (const model of data.cloudProviders[cloudProvider].supportedModels.models) {
      const key = normalizeModelIdentity(
        model.endpointName ?? model.modelServiceName ?? model.name,
      );
      const existing = groups.get(key);
      groups.set(key, {
        key,
        representative: existing?.representative ?? model,
        deployments: {
          ...existing?.deployments,
          [cloudProvider]: model,
        },
      });
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function flattenModelsDev(data: ModelsDevData): ModelsDevRecord[] {
  return Object.values(data).flatMap((provider) =>
    Object.entries(provider.models).map(([modelKey, model]) => ({
      provider,
      modelKey,
      model,
    })),
  );
}

function flattenArena(data: LMArenaCatalogData): ArenaRecord[] {
  return Object.entries(data.configurations).flatMap(([configuration, value]) =>
    value.rows.map((row) => ({ configuration, row })),
  );
}

function flattenLiveBench(data: LiveBenchCatalogData): LiveBenchRecord[] {
  const benchmarksByModel = liveBenchBenchmarks(data);
  return data.rows.map((row) => ({
    row,
    benchmarks: benchmarksByModel.get(row.model) ?? [],
  }));
}

function buildContext(
  group: DatabricksModelGroup,
  modelsDevRecords: readonly ModelsDevRecord[],
  modelParams: readonly ModelParamsModel[],
  arenaRecords: readonly ArenaRecord[],
  liveBenchRecords: readonly LiveBenchRecord[],
): ModelBuildContext {
  const groupIdentities = databricksIdentities(group);
  const matchingModelsDev = modelsDevRecords.filter((record) =>
    identitiesOverlap(groupIdentities, modelsDevIdentities(record)),
  );
  const primary = bestModelsDevRecord(group, matchingModelsDev);
  const exactDatabricks = matchingModelsDev.find(
    (record) =>
      record.provider.id === "databricks" &&
      normalizeModelIdentity(record.model.id) === group.key,
  );
  const selectedModelsDev = uniqueBy(
    [exactDatabricks, primary].filter(
      (record): record is ModelsDevRecord => record !== undefined,
    ),
    (record) => `${record.provider.id}/${record.model.id}`,
  );
  const aliases = unique([
    ...rawDatabricksAliases(group),
    ...selectedModelsDev.flatMap((record) => rawModelsDevAliases(record)),
  ]);
  const matchingModelParams = modelParams.filter((entry) =>
    identitiesOverlap(
      groupIdentities,
      [entry.model, entry.wireId].filter(
        (value): value is string => value !== undefined,
      ),
    ),
  );
  const matchingArena = arenaRecords.filter((entry) =>
    identitiesOverlap(groupIdentities, [arenaBaseName(entry.row.model_name)]),
  );
  const matchingLiveBench = liveBenchRecords.filter((entry) =>
    identitiesOverlap(groupIdentities, [liveBenchBaseName(entry.row.model)]),
  );

  return {
    group,
    id: databricksCatalogId(group),
    aliases,
    ...(primary ? { primary } : {}),
    modelsDevRecords: selectedModelsDev,
    modelParams: matchingModelParams,
    arena: matchingArena,
    liveBench: matchingLiveBench,
  };
}

function databricksCatalogId(group: DatabricksModelGroup): string {
  return (
    group.representative.endpointName ??
    group.representative.modelServiceName ??
    `databricks-${group.key}`
  );
}

function bestModelsDevRecord(
  group: DatabricksModelGroup,
  records: readonly ModelsDevRecord[],
): ModelsDevRecord | undefined {
  const match = [...records].sort((left, right) => {
    const score =
      modelsDevRecordScore(group, right) - modelsDevRecordScore(group, left);
    if (score !== 0) return score;
    return `${left.provider.id}/${left.model.id}`.localeCompare(
      `${right.provider.id}/${right.model.id}`,
    );
  })[0];
  return match && modelsDevRecordScore(group, match) >= 90 ? match : undefined;
}

function modelsDevRecordScore(
  group: DatabricksModelGroup,
  record: ModelsDevRecord,
): number {
  const modelId = normalizeModelIdentity(record.model.id);
  const canonical = canonicalIdentity(record.model.canonical_model_id);
  const owner = canonicalOwner(record.model.canonical_model_id);
  let score = 0;
  if (record.provider.id === "databricks" && modelId === group.key) score += 1_000;
  if (
    owner &&
    normalizeModelIdentity(record.provider.id) === normalizeModelIdentity(owner)
  ) {
    score += 600;
  }
  if (owner && providerPrefixMatches(group.representative.name, owner)) score += 550;
  if (providerPrefixMatches(group.representative.name, record.provider.id)) score += 500;
  if (providerPrefixMatches(group.representative.name, record.provider.name)) score += 500;
  if (modelId === group.key) score += 100;
  if (canonical === group.key) score += 90;
  if (identitiesOverlap(databricksIdentities(group), [record.model.name])) {
    score += 50;
  }
  return score;
}

function buildCatalogModel(
  context: ModelBuildContext,
  allContexts: readonly ModelBuildContext[],
  sources: CatalogSyncSources,
): CatalogModel {
  const { group, primary } = context;
  const representative = group.representative;
  const organization = catalogOrganization(context, sources.modelsDev.data);
  const license = mostCommon(context.arena.map(({ row }) => row.license));
  const prices = [
    ...Object.values(group.deployments).flatMap((deployment) =>
      deployment.pricing.map(databricksPrice),
    ),
  ];
  const modalities = catalogModalities(context);
  const retirement = catalogRetirement(context, allContexts);
  const limits = catalogLimits(primary?.model);

  return {
    name: representative.name,
    description:
      representative.description ||
      primary?.model.description ||
      representative.name,
    aliases: unique(context.aliases.filter((alias) => alias !== context.id)),
    type: catalogType(context),
    ...optional("family", primary?.model.family),
    ...optional("publisher", representative.publisher ?? organization),
    ...optional("license", license),
    ...(primary ? { open_weights: primary.model.open_weights } : {}),
    status: catalogStatus(context),
    ...optionalDate("release_date", primary?.model.release_date),
    ...optionalDate("last_updated", primary?.model.last_updated),
    ...optionalDate("knowledge_cutoff", primary?.model.knowledge),
    ...(retirement ? { retirement } : {}),
    modalities,
    capabilities: catalogCapabilities(context, modalities),
    ...(limits ? { limits } : {}),
    tasks: unique(
      Object.values(group.deployments).flatMap(
        (deployment) => deployment.taskTypes,
      ),
    ),
    use_cases: unique(
      Object.values(group.deployments).flatMap(
        (deployment) => deployment.useCases,
      ),
    ),
    availability: catalogAvailability(context),
    ...catalogPricing(prices),
    notices: catalogNotices(context),
    rankings: uniqueBy(context.arena.map(arenaRanking), JSON.stringify),
    benchmarks: uniqueBy(
      context.liveBench.flatMap((entry) => entry.benchmarks),
      JSON.stringify,
    ),
  };
}

function catalogType(context: ModelBuildContext): CatalogModelType {
  const upstreamType = context.primary?.model.type?.trim().toLowerCase();
  const knownUpstreamType = upstreamType
    ? Object.values(ModelType).find(
        (modelType) => modelType === normalizeEnumValue(upstreamType),
      )
    : undefined;
  if (knownUpstreamType) return knownUpstreamType;

  const searchable = [
    context.group.representative.name,
    ...Object.values(context.group.deployments).flatMap((deployment) => [
      ...deployment.taskTypes,
      ...deployment.useCases,
    ]),
  ]
    .join(" ")
    .toLowerCase();
  if (/\bembed(?:ding|dings)?\b/.test(searchable)) return ModelType.Embedding;
  if (/\brerank(?:er|ing)?\b/.test(searchable)) return ModelType.Reranking;
  if (/\bimage generation\b|\bimage model\b/.test(searchable)) {
    return ModelType.Image;
  }
  if (/\bvideo generation\b|\bvideo model\b/.test(searchable)) {
    return ModelType.Video;
  }
  if (/\btranscri(?:be|ption)\b|speech[- ]to[- ]text/.test(searchable)) {
    return ModelType.Transcription;
  }
  if (/text[- ]to[- ]speech|speech generation/.test(searchable)) {
    return ModelType.Speech;
  }
  return ModelType.Chat;
}

function catalogStatus(context: ModelBuildContext): CatalogModelStatus {
  if (
    Object.values(context.group.deployments).some(
      (deployment) => deployment.deprecated,
    )
  ) {
    return ModelStatus.Deprecated;
  }
  return normalizeModelStatus(context.group.representative.status);
}

function normalizeModelStatus(value: string): CatalogModelStatus {
  const normalized = normalizeEnumValue(value);
  if (
    normalized === "general_availability" ||
    normalized === "generally_available" ||
    normalized === "ga" ||
    normalized === "available"
  ) {
    return ModelStatus.Active;
  }
  if (normalized.includes("preview")) return ModelStatus.Preview;
  if (normalized.includes("experimental") || normalized.includes("alpha")) {
    return ModelStatus.Alpha;
  }
  if (normalized.includes("beta")) return ModelStatus.Beta;
  if (normalized.includes("legacy")) return ModelStatus.Legacy;
  if (normalized.includes("deprecated")) return ModelStatus.Deprecated;
  if (normalized.includes("retired")) return ModelStatus.Retired;
  if (normalized.includes("active")) return ModelStatus.Active;
  return ModelStatus.Active;
}

function catalogModalities(context: ModelBuildContext): CatalogModel["modalities"] {
  const type = catalogType(context);
  const input = unique(
    [
      ...(context.primary?.model.modalities.input ?? []),
      ...Object.values(context.group.deployments).flatMap(
        (deployment) => deployment.supportedInputs,
      ),
    ].flatMap((value) => {
      const modality = normalizeModality(value);
      return modality ? [modality] : [];
    }),
  );
  const output = unique(
    (context.primary?.model.modalities.output ?? []).flatMap((value) => {
      const modality = normalizeModality(value);
      return modality ? [modality] : [];
    }),
  );

  return {
    input: input.length > 0 ? input : [ModelModality.Text],
    output:
      output.length > 0 ? output : [defaultOutputModality(type)],
  };
}

function normalizeModality(value: string): CatalogModality | undefined {
  const normalized = value.trim().toLowerCase().replace(/s$/, "");
  if (normalized === "pdf" || normalized === "application/pdf") {
    return ModelModality.Pdf;
  }
  if (normalized === "text") return ModelModality.Text;
  if (normalized === "image") return ModelModality.Image;
  if (normalized === "audio") return ModelModality.Audio;
  if (normalized === "video") return ModelModality.Video;
  if (normalized === "embedding") return ModelModality.Embedding;
  if (normalized === "reranking") return ModelModality.Reranking;
  if (normalized === "decision") return ModelModality.Decision;
  return /^(text|image|audio|video|application)\/[a-z0-9.+-]+$/i.test(
    normalized,
  )
    ? normalized
    : undefined;
}

function defaultOutputModality(type: CatalogModelType): CatalogModality {
  if (type === ModelType.Embedding) return ModelModality.Embedding;
  if (type === ModelType.Reranking) return ModelModality.Reranking;
  if (type === ModelType.Decision) return ModelModality.Decision;
  if (type === ModelType.Image) return ModelModality.Image;
  if (type === ModelType.Video) return ModelModality.Video;
  if (type === ModelType.Speech || type === ModelType.Audio) {
    return ModelModality.Audio;
  }
  return ModelModality.Text;
}

function catalogCapabilities(
  context: ModelBuildContext,
  modalities: CatalogModel["modalities"],
): CatalogModel["capabilities"] {
  const model = context.primary?.model;
  const params = context.modelParams.flatMap((entry) => entry.params);
  const reasoning = catalogReasoning(context);
  const hasAttachmentInput = modalities.input.some(
    (modality) => modality !== ModelModality.Text,
  );
  const attachments =
    model?.attachment ?? (hasAttachmentInput ? true : undefined);
  const hasToolingParams = params.some((param) => param.group === "tooling");
  const tools = model?.tool_call ?? (hasToolingParams ? true : undefined);
  const hasOutputFormatParams = params.some(
    (param) => param.group === "output_format",
  );
  const structuredOutput =
    model?.structured_output ??
    (hasOutputFormatParams ? true : undefined);
  const hasTemperatureParam = params.some((param) =>
    /(^|\.)temperature$/i.test(param.path),
  );
  const temperature =
    model?.temperature ?? (hasTemperatureParam ? true : undefined);

  return {
    ...optional("attachments", attachments),
    ...optional("tools", tools),
    ...optional("structured_output", structuredOutput),
    ...optional("temperature", temperature),
    ...(model?.interleaved === undefined
      ? {}
      : { interleaved_reasoning: Boolean(model.interleaved) }),
    web_search: Object.values(context.group.deployments).some(
      (deployment) => deployment.webSearch,
    ),
    ...(reasoning ? { reasoning } : {}),
  };
}

function catalogReasoning(
  context: ModelBuildContext,
): ModelReasoning | undefined {
  const model = context.primary?.model;
  const documented = Object.values(context.group.deployments)
    .map((deployment) => deployment.reasoning)
    .find((value) => value !== undefined);
  const params = context.modelParams.flatMap((entry) =>
    entry.params.filter((param) => param.group === "reasoning"),
  );
  const options = model?.reasoning_options ?? [];
  const supported = Boolean(documented || model?.reasoning || params.length > 0);
  if (!supported) {
    return model ? { supported: false } : undefined;
  }

  const effort = unique(
    [
      ...(documented?.levels ?? []),
      ...options.flatMap((option) =>
        option.type === "effort" ? (option.values ?? []) : [],
      ),
      ...params.flatMap((param) =>
        /effort/i.test(`${param.path} ${param.label}`)
          ? (param.values ?? []).filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      ),
    ].flatMap((value) => {
      const normalized = normalizeReasoningEffort(value);
      return normalized ? [normalized] : [];
    }),
  );
  const defaultEffort = [
    documented?.defaultLevel,
    ...params.flatMap((param) =>
      /effort/i.test(`${param.path} ${param.label}`) &&
      typeof param.default === "string"
        ? [param.default]
        : [],
    ),
  ]
    .flatMap((value) => {
      const normalized = value ? normalizeReasoningEffort(value) : undefined;
      return normalized ? [normalized] : [];
    })
    .at(0);
  const toggle =
    documented?.canDisable ??
    (options.some((option) => option.type === "toggle") ||
    params.some(
      (param) =>
        param.type === "boolean" &&
        /reason|think|enable/i.test(`${param.path} ${param.label}`),
    )
      ? true
      : undefined);
  const budgetRanges = [
    ...options.flatMap((option) =>
      option.type === "budget_tokens"
        ? [{ min: option.min, max: option.max }]
        : [],
    ),
    ...params.flatMap((param) =>
      /budget/i.test(`${param.path} ${param.label}`)
        ? [{ min: param.range?.min, max: param.range?.max }]
        : [],
    ),
  ];
  const budgetMin = minimum(
    budgetRanges.flatMap(({ min }) => (min === undefined ? [] : [min])),
  );
  const budgetMax = maximum(
    budgetRanges.flatMap(({ max }) => (max === undefined ? [] : [max])),
  );
  const description = unique(
    [documented?.details, documented?.parameters].filter(
      (value): value is string => Boolean(value?.trim()),
    ),
  ).join(" ");

  return {
    supported: true,
    ...(effort.length > 0 ? { effort } : {}),
    ...optional("default_effort", defaultEffort),
    ...optional("toggle", toggle),
    ...(budgetMin === undefined && budgetMax === undefined
      ? {}
      : {
          budget: {
            ...optional("min", budgetMin),
            ...optional("max", budgetMax),
          },
        }),
    ...(description ? { description } : {}),
  };
}

function normalizeReasoningEffort(value: string): EvaluationVariant["reasoning_effort"] {
  const normalized = normalizeEnumValue(value).replace(/^extra_?high$/, "xhigh");
  const known = Object.values(ReasoningEffort).find(
    (effort) => effort === normalized,
  );
  return known;
}

function catalogLimits(model: ModelsDevModel | undefined): CatalogModel["limits"] {
  if (!model) return undefined;
  return {
    context: model.limit.context,
    ...optional("input", model.limit.input),
    output: model.limit.output,
  };
}

function databricksPrice(
  price: DatabricksSupportedModel["pricing"][number],
): CatalogPriceInput {
  return {
    cloudProvider: price.cloudProvider,
    measures: {
      [PriceCurrency.Dbu]: { unit: price.unit, rates: price.dbuRates },
      [PriceCurrency.Usd]: {
        unit: price.usdUnit,
        rates: price.usdRates,
      },
    },
  };
}

function catalogAvailability(
  context: ModelBuildContext,
): CatalogModel["availability"] {
  const deployments = Object.entries(context.group.deployments).flatMap(
    ([cloudProvider, model]) =>
      model
        ? [{ cloudProvider: cloudProvider as DatabricksCloudProvider, model }]
        : [],
  );
  return ModelAvailabilityByCloudSchema.parse(Object.fromEntries(
    deployments.map(({ cloudProvider, model }) => [
      cloudProvider,
      {
        status: model.deprecated
          ? ModelStatus.Deprecated
          : normalizeModelStatus(model.status),
        serving_modes: catalogServingModes(model),
        ...optional("details", model.availability),
      },
    ]),
  ));
}

function catalogServingModes(model: DatabricksSupportedModel) {
  const modes = unique([
    ...model.pricing.map((price) => {
      if (price.tier === "priority") return ServingMode.PriorityPayPerToken;
      if (price.tier === "provisioned") return ServingMode.ProvisionedThroughput;
      if (price.tier === "batch") return ServingMode.Batch;
      return ServingMode.PayPerToken;
    }),
    ...(/priority/i.test(model.availability ?? "")
      ? [ServingMode.PriorityPayPerToken]
      : []),
    ...(/provisioned/i.test(model.availability ?? "")
      ? [ServingMode.ProvisionedThroughput]
      : []),
    ...(/batch/i.test(model.availability ?? "") ? [ServingMode.Batch] : []),
    ...(/pay.?per.?token/i.test(model.availability ?? "")
      ? [ServingMode.PayPerToken]
      : []),
  ]);
  return modes.length > 0 ? modes : [ServingMode.PayPerToken];
}

function catalogRetirement(
  context: ModelBuildContext,
  allContexts: readonly ModelBuildContext[],
): CatalogModel["retirement"] {
  const retirements = Object.values(context.group.deployments).flatMap(
    (deployment) => deployment.retirements ?? [],
  );
  if (retirements.length === 0) return undefined;

  const schedules = new Map<string, string[]>();
  for (const retirement of retirements) {
    for (const schedule of retirement.schedules) {
      const dates = schedules.get(schedule.offering) ?? [];
      dates.push(...schedule.dates.map(dateString));
      schedules.set(schedule.offering, unique(dates).sort());
    }
  }
  const replacement = replacementId(context, allContexts);
  const replacementName = mostCommon(
    retirements.map((retirement) => retirement.replacementText).filter(Boolean),
  );
  return {
    schedules: [...schedules.entries()].map(([offering, dates]) => ({
      offering,
      dates,
    })),
    ...optional("replacement", replacement),
    ...(!replacement ? optional("replacement_name", replacementName) : {}),
  };
}

function catalogNotices(context: ModelBuildContext): CatalogModel["notices"] {
  return mergeNotices(
    Object.values(context.group.deployments).flatMap((model) =>
      model.notices.map((notice) => ({
        kind: notice.kind,
        ...optional("title", notice.title),
        text: notice.text,
      })),
    ),
  );
}

function mergeNotices(
  values: readonly CatalogModel["notices"][number][],
): CatalogModel["notices"] {
  const notices: CatalogModel["notices"] = [];
  for (const value of values) {
    const text = stripNoticeLabel(value.text);
    if (!text) continue;
    const title =
      value.title && !sameNoticeLabel(value.title, value.kind)
        ? value.title
        : undefined;
    const candidate = {
      kind: value.kind,
      ...(title ? { title } : {}),
      text,
    };
    const candidateKey = noticeIdentity(candidate.text);
    const existingIndex = notices.findIndex((notice) => {
      const existingKey = noticeIdentity(notice.text);
      return (
        existingKey === candidateKey ||
        existingKey.startsWith(candidateKey) ||
        candidateKey.startsWith(existingKey)
      );
    });
    if (existingIndex < 0) {
      notices.push(candidate);
      continue;
    }

    const existing = notices[existingIndex]!;
    const existingKey = noticeIdentity(existing.text);
    if (
      candidateKey.length > existingKey.length ||
      (candidateKey === existingKey && !existing.title && candidate.title)
    ) {
      notices[existingIndex] = candidate;
    }
  }
  return notices;
}

function stripNoticeLabel(value: string): string {
  return value
    .replace(/^(?:note|important|warning|tip|caution|info)\s*/i, "")
    .trim();
}

function sameNoticeLabel(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function noticeIdentity(value: string): string {
  return stripNoticeLabel(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function catalogPricing(
  prices: readonly CatalogPriceInput[],
): Pick<CatalogModel, "price" | "average_price"> {
  const cloudProviders = unique(
    prices
      .map((price) => price.cloudProvider)
      .filter(
        (cloudProvider): cloudProvider is DatabricksCloudProvider =>
          cloudProvider !== undefined,
      ),
  );
  return {
    average_price: averagePriceSummary(prices),
    price: Object.fromEntries(
      cloudProviders.map((cloudProvider) => [
        cloudProvider,
        averagePriceSummary(
          prices.filter((price) => price.cloudProvider === cloudProvider),
        ),
      ]),
    ) satisfies ModelPriceByCloud,
  };
}

function averagePriceSummary(
  prices: readonly CatalogPriceInput[],
): ModelPriceSummary {
  const deduplicated = uniqueBy(prices, priceValueIdentity);
  const measureNames = unique(
    deduplicated.flatMap((price) => Object.keys(price.measures)),
  );
  return ModelPriceSummarySchema.parse(Object.fromEntries(
    measureNames.flatMap((measureName) => {
      const measures = deduplicated.flatMap((price) => {
        const measure = price.measures[measureName];
        return measure ? [measure] : [];
      });
      const unit = mostCommon(measures.map((measure) => measure.unit));
      if (!unit) return [];
      const matching = measures.filter((measure) => measure.unit === unit);
      const rateNames = unique(
        matching.flatMap((measure) =>
          Object.keys(measure.rates).map((name) =>
            normalizeRateName(name, unit),
          ),
        ),
      );
      const rates = Object.fromEntries(
        rateNames.flatMap((rateName) => {
          const values = unique(
            matching.flatMap((measure) =>
              Object.entries(measure.rates).flatMap(([name, value]) =>
                normalizeRateName(name, unit) === rateName && value !== null
                  ? [value]
                  : [],
              ),
            ),
          );
          return values.length === 0
            ? []
            : [[rateName, average(values)] as const];
        }),
      );
      return Object.keys(rates).length === 0
        ? []
        : [[measureName, { unit: normalizePriceUnit(unit), rates }] as const];
    }),
  ));
}

function arenaRanking({ configuration, row }: ArenaRecord): ModelRanking {
  const common = {
    domain: configuration,
    category: row.category,
    rank: row.rank,
    published_at: dateString(row.leaderboard_publish_date),
    ...optional("variant", evaluationVariant(row.model_name)),
  };
  if (isRatingArenaRow(row)) {
    return {
      ...common,
      metric: RankingMetric.Rating,
      rating: row.rating,
      lower: row.rating_lower,
      upper: row.rating_upper,
      variance: row.variance,
      votes: row.vote_count,
    };
  }
  if (!isScoreArenaRow(row)) throw new Error("Unsupported LMArena row shape");
  return {
    ...common,
    metric: RankingMetric.Score,
    score: row.score,
    lower: row.score_ci_lower,
    upper: row.score_ci_upper,
    observations: row.observation_count,
    sessions: row.session_count,
  };
}

function liveBenchBenchmarks(
  data: LiveBenchCatalogData,
): Map<string, ModelBenchmark[]> {
  const categories = Object.entries(data.categories);
  const results = new Map<string, ModelBenchmark[]>();
  const configurations = [
    {
      category: "overall",
      scores: data.rows.flatMap((row) => {
        const categoryScores = categories.flatMap(([, tasks]) => {
          const score = liveBenchAverage(row, tasks);
          return score ? [score.score] : [];
        });
        const taskCount = categories.reduce(
          (count, [, tasks]) => count + liveBenchTaskCount(row, tasks),
          0,
        );
        return categoryScores.length === 0
          ? []
          : [{ row, score: average(categoryScores), taskCount }];
      }),
    },
    ...categories.map(([category, tasks]) => ({
      category,
      scores: data.rows.flatMap((row) => {
        const score = liveBenchAverage(row, tasks);
        return score ? [{ row, ...score }] : [];
      }),
    })),
  ];

  for (const configuration of configurations) {
    const ranked = [...configuration.scores].sort((left, right) => {
      const score = right.score - left.score;
      return score !== 0 ? score : left.row.model.localeCompare(right.row.model);
    });
    ranked.forEach((entry, index) => {
      const benchmark: ModelBenchmark = {
        name: configuration.category,
        rank: index + 1,
        published_at: dateString(data.release),
        score: entry.score,
        task_count: entry.taskCount,
        ...optional("variant", evaluationVariant(entry.row.model)),
      };
      const existing = results.get(entry.row.model) ?? [];
      existing.push(benchmark);
      results.set(entry.row.model, existing);
    });
  }

  return results;
}

function liveBenchAverage(
  row: LiveBenchRow,
  tasks: readonly string[],
): { readonly score: number; readonly taskCount: number } | undefined {
  const values = tasks.flatMap((task) => {
    const value = row.scores[task];
    return value === null || value === undefined ? [] : [value];
  });
  return values.length === 0
    ? undefined
    : { score: average(values), taskCount: values.length };
}

function liveBenchTaskCount(row: LiveBenchRow, tasks: readonly string[]): number {
  return tasks.filter(
    (task) => row.scores[task] !== null && row.scores[task] !== undefined,
  ).length;
}

function evaluationVariant(
  value: string,
): EvaluationVariant | undefined {
  const reasoningLevel = value
    .match(/(?:^|[^a-z])(extra[- ]?high|xhigh|high|medium|low)(?:[^a-z]|$)/i)?.[1]
    ?.toLowerCase()
    .replace(" ", "-");
  const harness = value.match(/\b([a-z0-9]+)\s+harness\b/i)?.[1]?.toLowerCase();
  const contextSize = value.match(/(?:^|[- (,])(\d+)k(?:[- )]|$)/i)?.[1];
  const reasoningMode = /(?:^|[- (])auto(?:[- )]|$)/i.test(value)
    ? ReasoningMode.Auto
    : /(?:^|[- (])thinking(?:[- )]|$)/i.test(value)
      ? ReasoningMode.Thinking
      : undefined;
  const reasoningEffort = reasoningLevel
    ? normalizeReasoningEffort(reasoningLevel)
    : undefined;
  const variant = {
    ...(reasoningEffort || reasoningMode ? { reasoning: true } : {}),
    ...optional("reasoning_effort", reasoningEffort),
    ...optional("reasoning_mode", reasoningMode),
    ...optional("harness", harness),
    ...(contextSize ? { context: Number(contextSize) * 1_000 } : {}),
  };
  return Object.keys(variant).length === 0 ? undefined : variant;
}

function isRatingArenaRow(row: LMArenaRow): row is RatingArenaRow {
  return (
    typeof row.rating === "number" &&
    typeof row.rating_lower === "number" &&
    typeof row.rating_upper === "number" &&
    typeof row.variance === "number" &&
    typeof row.vote_count === "number"
  );
}

function isScoreArenaRow(row: LMArenaRow): row is ScoreArenaRow {
  return (
    typeof row.score === "number" &&
    typeof row.score_ci_lower === "number" &&
    typeof row.score_ci_upper === "number" &&
    typeof row.observation_count === "number" &&
    (typeof row.session_count === "number" || row.session_count === null)
  );
}

function replacementId(
  context: ModelBuildContext,
  allContexts: readonly ModelBuildContext[],
): string | undefined {
  const replacements = unique(
    Object.values(context.group.deployments).flatMap((deployment) =>
      (deployment.retirements ?? [])
        .map((retirement) => retirement.replacementText)
        .filter(Boolean),
    ),
  );
  const matches = allContexts.filter((candidate) =>
    replacements.some((replacement) =>
      identitiesOverlap(databricksIdentities(candidate.group), [replacement]),
    ),
  );
  return matches.length === 1 ? matches[0]?.id : undefined;
}

function catalogOrganization(
  context: ModelBuildContext,
  modelsDev: ModelsDevData,
): string | undefined {
  const owner = context.modelsDevRecords
    .map((record) => canonicalOwner(record.model.canonical_model_id))
    .find((value): value is string => value !== undefined);
  const primaryOwner =
    context.primary &&
    (providerOwnsModel(context.primary) ||
      providerMatchesGroup(context.primary, context.group))
      ? context.primary.provider.name
      : undefined;
  return (
    (owner ? modelsDev[owner]?.name : undefined) ??
    mostCommon(context.arena.map(({ row }) => row.organization)) ??
    primaryOwner
  );
}

function databricksIdentities(group: DatabricksModelGroup): string[] {
  return unique(rawDatabricksAliases(group).map(normalizeModelIdentity));
}

function rawDatabricksAliases(group: DatabricksModelGroup): string[] {
  return unique(
    Object.values(group.deployments).flatMap((model) =>
      [model.name, model.endpointName, model.modelServiceName].filter(
        (value): value is string => value !== undefined,
      ),
    ),
  );
}

function modelsDevIdentities(record: ModelsDevRecord): string[] {
  return rawModelsDevAliases(record).map(normalizeModelIdentity);
}

function rawModelsDevAliases(record: ModelsDevRecord): string[] {
  return unique(
    [
      record.modelKey,
      record.model.id,
      record.model.name,
      record.model.canonical_model_id,
      record.model.canonical_model_id?.split("/").at(-1),
    ].filter((value): value is string => value !== undefined),
  );
}

function identitiesOverlap(
  leftValues: readonly string[],
  rightValues: readonly string[],
): boolean {
  const left = leftValues.map(normalizeModelIdentity).filter(Boolean);
  const right = rightValues.map(normalizeModelIdentity).filter(Boolean);
  return left.some((leftIdentity) =>
    right.some(
      (rightIdentity) =>
        leftIdentity === rightIdentity ||
        leftIdentity.endsWith(`-${rightIdentity}`) ||
        rightIdentity.endsWith(`-${leftIdentity}`),
    ),
  );
}

function canonicalIdentity(value: string | undefined): string | undefined {
  const identity = value?.split("/").at(-1);
  return identity ? normalizeModelIdentity(identity) : undefined;
}

function canonicalOwner(value: string | undefined): string | undefined {
  const separator = value?.indexOf("/") ?? -1;
  return separator > 0 ? value?.slice(0, separator) : undefined;
}

function providerOwnsModel(record: ModelsDevRecord): boolean {
  const owner = canonicalOwner(record.model.canonical_model_id);
  return owner
    ? normalizeModelIdentity(owner) === normalizeModelIdentity(record.provider.id)
    : providerPrefixMatches(record.model.name, record.provider.id) ||
        providerPrefixMatches(record.model.name, record.provider.name);
}

function providerMatchesGroup(
  record: ModelsDevRecord,
  group: DatabricksModelGroup,
): boolean {
  return (
    providerPrefixMatches(group.representative.name, record.provider.id) ||
    providerPrefixMatches(group.representative.name, record.provider.name)
  );
}

function providerPrefixMatches(modelName: string, providerName: string): boolean {
  const model = normalizeModelIdentity(modelName);
  const provider = normalizeModelIdentity(providerName);
  return Boolean(provider) && (model === provider || model.startsWith(`${provider}-`));
}

function arenaBaseName(value: string): string {
  return value.replace(ARENA_VARIANT_SUFFIX, "").trim();
}

function liveBenchBaseName(value: string): string {
  return value.replace(LIVEBENCH_VARIANT_SUFFIX, "").trim();
}

function priceValueIdentity(price: CatalogPriceInput): string {
  return JSON.stringify(price.measures);
}

function normalizeRateName(value: string, unit: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return unit.includes("per-hour") && /^(?:dbu|usd)_per_hour$/.test(normalized)
    ? "hour"
    : normalized;
}

function normalizePriceUnit(value: string) {
  if (value.includes("per-million-tokens")) return PriceUnit.MillionTokens;
  if (value.includes("per-hour-per-50-model-units")) {
    return PriceUnit.HourPer50ModelUnits;
  }
  if (value.includes("per-hour")) return PriceUnit.Hour;
  throw new Error(`Unsupported Databricks price unit: ${value}`);
}

function average(values: readonly number[]): number {
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  return Number(value.toFixed(6));
}

function latestFetchedAt(sources: CatalogSyncSources): string {
  return [
    sources.modelsDev.fetchedAt,
    sources.modelParams.fetchedAt,
    sources.lmArena.fetchedAt,
    sources.liveBench.fetchedAt,
    sources.databricks.fetchedAt,
  ].sort().at(-1)!;
}

function minimum(values: readonly number[]): number | undefined {
  return values.length > 0 ? Math.min(...values) : undefined;
}

function maximum(values: readonly number[]): number | undefined {
  return values.length > 0 ? Math.max(...values) : undefined;
}

function dateString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const exactDate = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (exactDate) return exactDate;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid catalog date: ${value}`);
  return parsed.toISOString().slice(0, 10);
}

function optionalDate<const TKey extends string>(
  key: TKey,
  value: Date | string | undefined,
): Record<string, string> {
  return value === undefined ? {} : { [key]: dateString(value) };
}

function optional<const TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Record<string, TValue> {
  return value === undefined ? {} : { [key]: value };
}

function normalizeEnumValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mostCommon(values: readonly string[]): string | undefined {
  const counts = countBy(values.filter(Boolean), (value) => value);
  return [...counts].sort((left, right) => {
    const count = right[1] - left[1];
    return count !== 0 ? count : left[0].localeCompare(right[0]);
  })[0]?.[0];
}

function countBy<T>(
  values: readonly T[],
  key: (value: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const itemKey = key(value);
    counts.set(itemKey, (counts.get(itemKey) ?? 0) + 1);
  }
  return counts;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}
