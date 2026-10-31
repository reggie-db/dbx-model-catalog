import {
  CloudProvider,
  CloudProviderSchema,
} from "@dbx-model-catalog/common";
import { load, type CheerioAPI } from "cheerio";
import { z } from "zod";
import {
  SyncClient,
  type Fetcher,
  type SyncClientOptions,
} from "./client.ts";
import { flexibleDateSchema, parseFlexibleDate } from "./date.ts";

type Selection = ReturnType<CheerioAPI>;

export const DatabricksCloudProvider = CloudProvider;
export const DatabricksCloudProviderSchema = CloudProviderSchema;

export type DatabricksCloudProvider = z.infer<
  typeof DatabricksCloudProviderSchema
>;

export const DATABRICKS_CLOUD_PROVIDERS = DatabricksCloudProviderSchema.options;

const DOCS_BASE_URLS = {
  [DatabricksCloudProvider.Aws]: "https://docs.databricks.com/aws/en",
  [DatabricksCloudProvider.Azure]:
    "https://learn.microsoft.com/en-us/azure/databricks",
  [DatabricksCloudProvider.Gcp]: "https://docs.databricks.com/gcp/en",
} satisfies Record<DatabricksCloudProvider, string>;

const SUPPORTED_MODELS_PATH =
  "/machine-learning/foundation-model-apis/supported-models";
const SCORE_FOUNDATION_MODELS_PATH =
  "/machine-learning/model-serving/score-foundation-models";
const REASONING_MODELS_PATH =
  "/machine-learning/model-serving/query-reason-models";
const WEB_SEARCH_PATH = "/machine-learning/model-serving/web-search";
const RETIRED_MODELS_POLICY_PATH = "/machine-learning/retired-models-policy";

export const DATABRICKS_FOUNDATION_MODEL_PRICING_URL =
  "https://www.databricks.com/product/pricing/foundation-model-serving";
export const DATABRICKS_PROPRIETARY_MODEL_PRICING_URL =
  "https://www.databricks.com/product/pricing/proprietary-foundation-model-serving";
export const DATABRICKS_GENAI_PRICING_CALCULATOR_URL =
  "https://www.databricks.com/product/pricing/genai-pricing-calculator";

function docsUrls(cloudProvider: DatabricksCloudProvider) {
  return {
    supportedModels: `${DOCS_BASE_URLS[cloudProvider]}${SUPPORTED_MODELS_PATH}`,
    scoreFoundationModels: `${DOCS_BASE_URLS[cloudProvider]}${SCORE_FOUNDATION_MODELS_PATH}`,
    reasoningModels: `${DOCS_BASE_URLS[cloudProvider]}${REASONING_MODELS_PATH}`,
    webSearch: `${DOCS_BASE_URLS[cloudProvider]}${WEB_SEARCH_PATH}`,
    retiredModelsPolicy: `${DOCS_BASE_URLS[cloudProvider]}${RETIRED_MODELS_POLICY_PATH}`,
  } as const;
}

export const DATABRICKS_CLOUD_PROVIDER_DOCS_URLS = {
  [DatabricksCloudProvider.Aws]: docsUrls(DatabricksCloudProvider.Aws),
  [DatabricksCloudProvider.Azure]: docsUrls(DatabricksCloudProvider.Azure),
  [DatabricksCloudProvider.Gcp]: docsUrls(DatabricksCloudProvider.Gcp),
} satisfies Record<DatabricksCloudProvider, ReturnType<typeof docsUrls>>;

export const DatabricksLinkSchema = z.looseObject({
  text: z.string(),
  url: z.string(),
});

export const DatabricksPageMetadataSchema = z.looseObject({
  sourceUrl: z.string(),
  canonicalUrl: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  lastUpdated: z.date().optional(),
});

export const DatabricksNoticeSchema = z.looseObject({
  kind: z.string(),
  title: z.string().optional(),
  text: z.string(),
  links: z.array(DatabricksLinkSchema),
});

export const DatabricksReasoningLevelSchema = z.string().min(1);

export const DatabricksModelReasoningSchema = z.looseObject({
  type: z.string(),
  details: z.string(),
  parameters: z.string(),
  levels: z.array(DatabricksReasoningLevelSchema),
  defaultLevel: DatabricksReasoningLevelSchema.optional(),
  canDisable: z.boolean().optional(),
});

export const DatabricksPricingTierSchema = z.enum([
  "standard",
  "priority",
  "provisioned",
  "batch",
]);

export const DatabricksPricingUnitSchema = z.enum([
  "dbu-per-million-tokens",
  "dbu-per-hour",
  "dbu-per-hour-per-50-model-units",
]);

export const DatabricksUsdPricingUnitSchema = z.enum([
  "usd-per-million-tokens",
  "usd-per-hour",
  "usd-per-hour-per-50-model-units",
]);

const USD_UNIT_BY_DBU_UNIT = {
  "dbu-per-million-tokens": "usd-per-million-tokens",
  "dbu-per-hour": "usd-per-hour",
  "dbu-per-hour-per-50-model-units": "usd-per-hour-per-50-model-units",
} satisfies Record<
  z.infer<typeof DatabricksPricingUnitSchema>,
  z.infer<typeof DatabricksUsdPricingUnitSchema>
>;

export const DatabricksPricingEntrySchema = z.looseObject({
  sourceUrl: z.string(),
  modelLabel: z.string(),
  modelKey: z.string(),
  tier: DatabricksPricingTierSchema,
  unit: DatabricksPricingUnitSchema,
  condition: z.string().optional(),
  dbuRates: z.record(z.string(), z.number().nonnegative().nullable()),
});

export const DatabricksCloudProviderPricingEntrySchema =
  DatabricksPricingEntrySchema.extend({
    cloudProvider: DatabricksCloudProviderSchema,
    defaultRegion: z.string(),
    currency: z.literal("USD"),
    usdPerDbu: z.number().nonnegative(),
    usdUnit: DatabricksUsdPricingUnitSchema,
    usdRates: z.record(z.string(), z.number().nonnegative().nullable()),
  });

export const DatabricksSupportedModelStatusSchema = z.string().min(1);

export const DatabricksRetirementScheduleSchema = z.looseObject({
  offering: z.string(),
  text: z.string(),
  dates: z.array(z.date()),
});

export const DatabricksRetiredModelSchema = z.looseObject({
  category: z.string(),
  names: z.array(z.string()).min(1),
  retirementText: z.string(),
  schedules: z.array(DatabricksRetirementScheduleSchema),
  replacementText: z.string(),
  columns: z.record(z.string(), z.string()),
  links: z.array(DatabricksLinkSchema),
});

export const DatabricksSupportedModelSchema = z.looseObject({
  sectionId: z.string(),
  name: z.string(),
  publisher: z.string().optional(),
  modelServiceName: z.string().optional(),
  endpointName: z.string().optional(),
  supportedInputs: z.array(z.string()),
  status: DatabricksSupportedModelStatusSchema,
  description: z.string(),
  paragraphs: z.array(z.string()),
  availability: z.string().optional(),
  notices: z.array(DatabricksNoticeSchema),
  links: z.array(DatabricksLinkSchema),
  taskTypes: z.array(z.string()),
  useCases: z.array(z.string()),
  reasoning: DatabricksModelReasoningSchema.optional(),
  webSearch: z.boolean(),
  deprecated: z.boolean(),
  retirements: z.array(DatabricksRetiredModelSchema),
  pricing: z.array(DatabricksCloudProviderPricingEntrySchema),
});

export const DatabricksSupportedModelsPageSchema = z.looseObject({
  metadata: DatabricksPageMetadataSchema,
  introduction: z.array(z.string()),
  models: z.array(DatabricksSupportedModelSchema),
  additionalResources: z.array(DatabricksLinkSchema),
});

export const DatabricksQueryMethodSchema = z.looseObject({
  name: z.string(),
  details: z.string(),
  links: z.array(DatabricksLinkSchema),
});

export const DatabricksTaskTypeSchema = z.looseObject({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  hostedModels: z.array(z.string()),
  externalModels: z.array(z.string()),
  supportedModelsText: z.string(),
  useCases: z.array(z.string()),
});

export const DatabricksDocumentationSectionSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  level: z.number().int().min(1).max(6),
  paragraphs: z.array(z.string()),
  listItems: z.array(z.string()),
  codeBlocks: z.array(z.string()),
  links: z.array(DatabricksLinkSchema),
});

export const DatabricksScoreFoundationModelsPageSchema = z.looseObject({
  metadata: DatabricksPageMetadataSchema,
  introduction: z.array(z.string()),
  queryMethods: z.array(DatabricksQueryMethodSchema),
  taskTypes: z.array(DatabricksTaskTypeSchema),
  sections: z.array(DatabricksDocumentationSectionSchema),
});

export const DatabricksWebSearchModelGroupSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  models: z.array(z.string()),
  paragraphs: z.array(z.string()),
  links: z.array(DatabricksLinkSchema),
});

export const DatabricksWebSearchPageSchema = z.looseObject({
  metadata: DatabricksPageMetadataSchema,
  introduction: z.array(z.string()),
  models: z.array(z.string()),
  modelGroups: z.array(DatabricksWebSearchModelGroupSchema),
});

export const DatabricksRetiredModelsPageSchema = z.looseObject({
  metadata: DatabricksPageMetadataSchema,
  introduction: z.array(z.string()),
  models: z.array(DatabricksRetiredModelSchema),
  sections: z.array(DatabricksDocumentationSectionSchema),
});

const DatabricksUsdPerDbuSchema = z.looseObject({
  [DatabricksCloudProvider.Aws]: z.number().nonnegative(),
  [DatabricksCloudProvider.Azure]: z.number().nonnegative(),
  [DatabricksCloudProvider.Gcp]: z.number().nonnegative(),
});

const DatabricksDefaultRegionsSchema = z.looseObject({
  [DatabricksCloudProvider.Aws]: z.string(),
  [DatabricksCloudProvider.Azure]: z.string(),
  [DatabricksCloudProvider.Gcp]: z.string(),
});

export const DatabricksPricingCatalogSchema = z.looseObject({
  sourceUrls: z.array(z.string()),
  defaultRegions: DatabricksDefaultRegionsSchema,
  usdPerDbu: DatabricksUsdPerDbuSchema,
  entries: z.array(DatabricksPricingEntrySchema),
});

export const DatabricksCloudProviderDocumentationSchema = z.looseObject({
  cloudProvider: DatabricksCloudProviderSchema,
  supportedModels: DatabricksSupportedModelsPageSchema,
  scoreFoundationModels: DatabricksScoreFoundationModelsPageSchema,
  webSearch: DatabricksWebSearchPageSchema,
  retiredModelsPolicy: DatabricksRetiredModelsPageSchema,
});

export const databricksCatalogSchema = z.looseObject({
  pricing: DatabricksPricingCatalogSchema,
  cloudProviders: z.record(
    DatabricksCloudProviderSchema,
    DatabricksCloudProviderDocumentationSchema,
  ),
});

export type DatabricksSupportedModelsPage = z.infer<
  typeof DatabricksSupportedModelsPageSchema
>;
export type DatabricksScoreFoundationModelsPage = z.infer<
  typeof DatabricksScoreFoundationModelsPageSchema
>;
export type DatabricksWebSearchPage = z.infer<
  typeof DatabricksWebSearchPageSchema
>;
export type DatabricksRetiredModel = z.infer<
  typeof DatabricksRetiredModelSchema
>;
export type DatabricksRetiredModelsPage = z.infer<
  typeof DatabricksRetiredModelsPageSchema
>;
export type DatabricksPricingEntry = z.infer<
  typeof DatabricksPricingEntrySchema
>;
export type DatabricksPricingCatalog = z.infer<
  typeof DatabricksPricingCatalogSchema
>;
export type DatabricksCatalogData = z.infer<typeof databricksCatalogSchema>;

interface ReasoningEntry {
  readonly models: readonly string[];
  readonly reasoning: z.infer<typeof DatabricksModelReasoningSchema>;
}

const PRICING_CONDITIONS = new Set([
  "short context",
  "long context",
  "text tokens",
  "image tokens",
  "audio tokens",
]);

const GENAI_CALCULATOR_COMPONENT =
  "component---src-pages-product-pricing-genai-pricing-calculator-tsx";

export class DatabricksSyncClient extends SyncClient<DatabricksCatalogData> {
  protected readonly schema = databricksCatalogSchema;

  public constructor(
    private readonly fetcher: Fetcher = fetch,
    options: SyncClientOptions = {},
  ) {
    super(options);
  }

  public async read(): Promise<DatabricksCatalogData> {
    const [pricing, cloudProviderPages] = await Promise.all([
      this.readPricing(),
      Promise.all(
        DATABRICKS_CLOUD_PROVIDERS.map(async (cloudProvider) => {
          const urls = DATABRICKS_CLOUD_PROVIDER_DOCS_URLS[cloudProvider];
          const [
            supportedHtml,
            scoreHtml,
            reasoningHtml,
            webSearchHtml,
            retiredModelsHtml,
          ] = await Promise.all([
            this.readPage(urls.supportedModels),
            this.readPage(urls.scoreFoundationModels),
            this.readPage(urls.reasoningModels),
            this.readPage(urls.webSearch),
            this.readPage(urls.retiredModelsPolicy),
          ]);
          return {
            cloudProvider,
            urls,
            supportedHtml,
            scoreHtml,
            reasoningHtml,
            webSearchHtml,
            retiredModelsHtml,
          };
        }),
      ),
    ]);

    const allReasoning = uniqueBy(
      cloudProviderPages.flatMap(({ reasoningHtml }) =>
        parseDatabricksReasoningModelsPage(reasoningHtml),
      ),
      (entry) => entry.models.join("|"),
    );
    const cloudProviders = Object.fromEntries(
      cloudProviderPages.map(
        ({
          cloudProvider,
          urls,
          supportedHtml,
          scoreHtml,
          webSearchHtml,
          retiredModelsHtml,
        }) => {
          const scoreFoundationModels = parseDatabricksScoreFoundationModelsPage(
            scoreHtml,
            urls.scoreFoundationModels,
          );
          const webSearch = parseDatabricksWebSearchPage(
            webSearchHtml,
            urls.webSearch,
          );
          const retiredModelsPolicy = parseDatabricksRetiredModelsPage(
            retiredModelsHtml,
            urls.retiredModelsPolicy,
          );
          const supportedModels = enrichSupportedModels(
            parseDatabricksSupportedModelsPage(
              supportedHtml,
              urls.supportedModels,
            ),
            scoreFoundationModels,
            webSearch,
            allReasoning,
            retiredModelsPolicy,
            pricing,
            cloudProvider,
          );

          return [
            cloudProvider,
            {
              cloudProvider,
              supportedModels,
              scoreFoundationModels,
              webSearch,
              retiredModelsPolicy,
            },
          ] as const;
        },
      ),
    );

    return this.parse({ pricing, cloudProviders });
  }

  private async readPricing(): Promise<DatabricksPricingCatalog> {
    const [foundationHtml, proprietaryHtml, calculatorHtml] = await Promise.all([
      this.readPage(DATABRICKS_FOUNDATION_MODEL_PRICING_URL),
      this.readPage(DATABRICKS_PROPRIETARY_MODEL_PRICING_URL),
      this.readPage(DATABRICKS_GENAI_PRICING_CALCULATOR_URL),
    ]);
    const calculatorAssetUrl = databricksCalculatorAssetUrl(
      calculatorHtml,
      DATABRICKS_GENAI_PRICING_CALCULATOR_URL,
    );
    const calculatorJavascript = await this.readPage(calculatorAssetUrl);
    const cloudProviderPricing = parseDatabricksCloudProviderPricing(
      calculatorJavascript,
    );

    return DatabricksPricingCatalogSchema.parse({
      sourceUrls: [
        DATABRICKS_FOUNDATION_MODEL_PRICING_URL,
        DATABRICKS_PROPRIETARY_MODEL_PRICING_URL,
        DATABRICKS_GENAI_PRICING_CALCULATOR_URL,
        calculatorAssetUrl,
      ],
      defaultRegions: cloudProviderPricing.defaultRegions,
      usdPerDbu: cloudProviderPricing.usdPerDbu,
      entries: parseDatabricksPricingPages(
        foundationHtml,
        proprietaryHtml,
      ),
    });
  }

  private async readPage(url: string): Promise<string> {
    return this.cacheGetOrSet(url, async () => {
      const response = await this.fetcher(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "dbx-model-catalog/0.0.0",
        },
      });
      if (!response.ok) {
        throw new Error(
          `GET ${url} failed with ${response.status} ${response.statusText}`,
        );
      }
      return response.text();
    });
  }
}

export function parseDatabricksSupportedModelsPage(
  html: string,
  sourceUrl: string,
): DatabricksSupportedModelsPage {
  const $ = load(html);
  const headings = $("h2").toArray();
  const models = headings.flatMap((heading) => {
    const section = $(heading);
    const nodes = siblingSection(section);
    const paragraphs = unique(
      nodes.flatMap((node) => paragraphTexts(node, $)),
    );
    const modelServiceName = labeledCode(paragraphs, nodes, "Model service name:", $);
    const endpointName = labeledCode(paragraphs, nodes, "Endpoint name:", $);
    if (!modelServiceName && !endpointName) return [];

    const name = cleanText(section.text());
    const supportedInputs = splitList(labeledText(paragraphs, "Supported inputs:"));
    const availability = labeledText(paragraphs, "Availability:");
    const publisherName =
      labeledText(paragraphs, "Publisher:") ??
      labeledText(paragraphs, "Provider:");
    const explicitStatus = labeledText(paragraphs, "Status:");
    const descriptionParagraphs = paragraphs.filter(
      (paragraph) =>
        !paragraph.startsWith("Model service name:") &&
        !paragraph.startsWith("Endpoint name:") &&
        !paragraph.startsWith("Supported inputs:") &&
        !paragraph.startsWith("Availability:") &&
        !paragraph.startsWith("Publisher:") &&
        !paragraph.startsWith("Provider:") &&
        !paragraph.startsWith("Status:") &&
        !paragraph.startsWith("AI models can make mistakes"),
    );
    const notices = nodes.flatMap((node) => parseNotices(node, $, sourceUrl));
    const sectionText = [name, ...paragraphs, ...notices.map((notice) => notice.text)]
      .join(" ")
      .toLowerCase();

    return [
      {
        sectionId: section.attr("id") ?? slug(name),
        name,
        ...(publisherName ? { publisher: publisherName } : {}),
        ...(modelServiceName ? { modelServiceName } : {}),
        ...(endpointName ? { endpointName } : {}),
        supportedInputs,
        status: explicitStatus ? slug(explicitStatus) : modelStatus(sectionText),
        description: descriptionParagraphs.join("\n\n"),
        paragraphs,
        ...(availability ? { availability } : {}),
        notices,
        links: linksFrom(nodes, $, sourceUrl),
        taskTypes: [],
        useCases: [],
        webSearch: false,
        deprecated: false,
        retirements: [],
        pricing: [],
      },
    ];
  });

  const firstModelHeading = headings.find((heading) => {
    const nodes = siblingSection($(heading));
    return nodes.some((node) => collapseText(node).includes("Model service name:"));
  });
  const introduction = firstModelHeading
    ? contentBetween($("h1").first(), $(firstModelHeading), $)
    : [];
  const additionalHeading = $("#additional-resources").first();

  return DatabricksSupportedModelsPageSchema.parse({
    metadata: pageMetadata($, sourceUrl),
    introduction,
    models,
    additionalResources:
      additionalHeading.length > 0
        ? linksFrom(siblingSection(additionalHeading), $, sourceUrl)
        : [],
  });
}

export function parseDatabricksScoreFoundationModelsPage(
  html: string,
  sourceUrl: string,
): DatabricksScoreFoundationModelsPage {
  const $ = load(html);
  const queryMethods = new Map<string, z.infer<typeof DatabricksQueryMethodSchema>>();
  const taskTypes = new Map<string, z.infer<typeof DatabricksTaskTypeSchema>>();

  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    const headers = rowCells($(rows.get(0)), $).map((cell) => cell.text.toLowerCase());
    if (headers[0] === "method" && headers[1] === "details") {
      rows.slice(1).each((__, row) => {
        const cells = $(row).find("th, td").toArray().map((cell) => $(cell));
        const name = collapseText(cells[0]);
        const details = collapseText(cells[1]);
        if (!name || !details) return;
        queryMethods.set(name, {
          name,
          details,
          links: linksFrom(cells.slice(1), $, sourceUrl),
        });
      });
      return;
    }
    if (headers[0] !== "task type" || !headers.includes("supported models")) return;
    rows.slice(1).each((__, row) => {
      const cells = $(row).find("th, td").toArray().map((cell) => $(cell));
      if (cells.length < 4) return;
      const name = collapseText(cells[0]);
      if (!name) return;
      const supportedCell = cells[2]!;
      const supportedModelsText = collapseText(supportedCell);
      const hostedModels = unique([
        ...supportedCell.find("code").toArray().map((code) => cleanText($(code).text())),
        ...(supportedModelsText.match(/databricks-[a-z0-9._-]+/gi) ?? []),
      ]).filter((model) => model.startsWith("databricks-"));
      const externalModels = unique(
        supportedCell
          .find("li")
          .toArray()
          .map((item) => collapseText($(item)))
          .filter((item) => !item.includes("databricks-")),
      );
      const useCaseCell = cells[3]!;
      const useCases = unique(
        useCaseCell.find("li").toArray().map((item) => collapseText($(item))),
      );

      taskTypes.set(name, {
        name,
        slug: slug(name),
        description: collapseText(cells[1]),
        hostedModels,
        externalModels,
        supportedModelsText,
        useCases: useCases.length > 0 ? useCases : [collapseText(useCaseCell)],
      });
    });
  });

  return DatabricksScoreFoundationModelsPageSchema.parse({
    metadata: pageMetadata($, sourceUrl),
    introduction: contentBetween($("h1").first(), $("h2").first(), $),
    queryMethods: [...queryMethods.values()],
    taskTypes: [...taskTypes.values()],
    sections: parseDocumentationSections($, sourceUrl),
  });
}

export function parseDatabricksWebSearchPage(
  html: string,
  sourceUrl: string,
): DatabricksWebSearchPage {
  const $ = load(html);
  const supportedHeading = $("#supported-models").first();
  const supportedNodes =
    supportedHeading.length > 0 ? siblingSection(supportedHeading) : [];
  const groupHeadings = supportedNodes.filter(
    (node) => headingLevel(nodeTagName(node.get(0))) !== Number.POSITIVE_INFINITY,
  );
  const modelGroups = groupHeadings.map((heading) => {
    const title = collapseText(heading);
    const nodes = siblingSection(heading);
    return {
      id: heading.attr("id") ?? slug(title),
      title,
      models: codeValuesFrom(nodes, $),
      paragraphs: unique(nodes.flatMap((node) => paragraphTexts(node, $))),
      links: linksFrom(nodes, $, sourceUrl),
    };
  });
  const ungroupedModels = codeValuesFrom(
    supportedNodes.filter(
      (node) => headingLevel(nodeTagName(node.get(0))) === Number.POSITIVE_INFINITY,
    ),
    $,
  );

  return DatabricksWebSearchPageSchema.parse({
    metadata: pageMetadata($, sourceUrl),
    introduction: contentBetween($("h1").first(), $("h2").first(), $),
    models: unique([
      ...modelGroups.flatMap((group) => group.models),
      ...ungroupedModels,
    ]),
    modelGroups,
  });
}

export function parseDatabricksRetiredModelsPage(
  html: string,
  sourceUrl: string,
): DatabricksRetiredModelsPage {
  const $ = load(html);
  const models: DatabricksRetiredModel[] = [];

  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    const headers = rowCells($(rows.get(0)), $).map((cell) => cell.text);
    const modelIndex = headers.findIndex(
      (header) => /\bmodel\b/i.test(header) && !/replacement/i.test(header),
    );
    const retirementIndex = headers.findIndex((header) => /retir/i.test(header));
    const replacementIndex = headers.findIndex((header) => /replacement/i.test(header));
    if (modelIndex < 0 || retirementIndex < 0) return;

    rows.slice(1).each((__, row) => {
      const cells = $(row).find("th, td").toArray().map((cell) => $(cell));
      const modelCell = cells[modelIndex];
      const retirementCell = cells[retirementIndex];
      if (!modelCell || !retirementCell) return;
      const names = unique(
        collapseText(modelCell)
          .split(/\s*\/\s*/)
          .map(cleanText)
          .filter(Boolean),
      );
      if (names.length === 0) return;
      const replacementCell = replacementIndex >= 0 ? cells[replacementIndex] : undefined;

      models.push({
        category: headers[modelIndex] ?? "Model",
        names,
        retirementText: collapseText(retirementCell),
        schedules: retirementSchedules(retirementCell, $),
        replacementText: replacementCell ? collapseText(replacementCell) : "",
        columns: Object.fromEntries(
          headers.flatMap((header, index) => {
            const cell = cells[index];
            return header && cell ? [[header, collapseText(cell)] as const] : [];
          }),
        ),
        links: linksFrom(cells, $, sourceUrl),
      });
    });
  });

  const uniqueModels = uniqueBy(
    models,
    (model) =>
      `${model.category}|${model.names.join("|")}|${model.retirementText}|${model.replacementText}`,
  );
  if (uniqueModels.length === 0) {
    throw new Error("Databricks retirement tables contained no model rows");
  }

  return DatabricksRetiredModelsPageSchema.parse({
    metadata: pageMetadata($, sourceUrl),
    introduction: contentBetween($("h1").first(), $("h2").first(), $),
    models: uniqueModels,
    sections: parseDocumentationSections($, sourceUrl),
  });
}

export function parseDatabricksPricingPages(
  foundationHtml: string,
  proprietaryHtml: string,
): DatabricksPricingEntry[] {
  return DatabricksPricingEntrySchema.array().parse([
    ...parsePricingPage(
      foundationHtml,
      DATABRICKS_FOUNDATION_MODEL_PRICING_URL,
    ),
    ...parsePricingPage(
      proprietaryHtml,
      DATABRICKS_PROPRIETARY_MODEL_PRICING_URL,
    ),
  ]);
}

function parseDatabricksReasoningModelsPage(html: string): ReasoningEntry[] {
  const $ = load(html);
  const entries = new Map<string, ReasoningEntry>();
  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    const headers = rowCells($(rows.get(0)), $).map((cell) => cell.text.toLowerCase());
    if (!headers.some((header) => header.includes("reasoning model type"))) return;
    rows.slice(1).each((__, row) => {
      const cells = $(row).find("th, td").toArray().map((cell) => $(cell));
      if (cells.length < 4) return;
      const modelsText = collapseText(cells[0]);
      const models = unique([
        ...cells[0]!.find("code").toArray().map((code) => cleanText($(code).text())),
        ...(modelsText.match(/databricks-[a-z0-9._-]+/gi) ?? []),
      ]);
      if (models.length === 0) return;
      const details = collapseText(cells[2]);
      const parameters = collapseText(cells[3]);
      const combined = `${details} ${parameters}`;
      const levels = reasoningLevels(parameters);
      const defaultLevel = defaultReasoningLevel(parameters);
      const canDisable = reasoningCanDisable(combined);
      const reasoning = {
        type: collapseText(cells[1]),
        details,
        parameters,
        levels,
        ...(defaultLevel ? { defaultLevel } : {}),
        ...(canDisable === undefined ? {} : { canDisable }),
      };
      for (const model of models) {
        entries.set(model, { models, reasoning });
      }
    });
  });
  return uniqueBy([...entries.values()], (entry) => entry.models.join("|"));
}

function enrichSupportedModels(
  page: DatabricksSupportedModelsPage,
  scorePage: DatabricksScoreFoundationModelsPage,
  webSearchPage: DatabricksWebSearchPage,
  reasoningEntries: readonly ReasoningEntry[],
  retiredModelsPage: DatabricksRetiredModelsPage,
  pricing: DatabricksPricingCatalog,
  cloudProvider: DatabricksCloudProvider,
): DatabricksSupportedModelsPage {
  const reasoningByModel = new Map(
    reasoningEntries.flatMap((entry) =>
      entry.models.map((model) => [model, entry.reasoning] as const),
    ),
  );

  return DatabricksSupportedModelsPageSchema.parse({
    ...page,
    models: page.models.map((model) => {
      const endpoint = model.endpointName;
      const tasks = endpoint
        ? scorePage.taskTypes.filter((task) => task.hostedModels.includes(endpoint))
        : [];
      const aliases = modelAliases(model);
      const webSearch = webSearchPage.models.some((documentedModel) =>
        aliasesIncludeIdentity(aliases, documentedModel),
      );
      const retirements = retiredModelsPage.models.filter((retiredModel) =>
        retiredModel.names.some((name) => aliasesIncludeIdentity(aliases, name)),
      );
      const pricingKeys = matchingPricingKeys(
        aliases,
        pricing.entries.map((entry) => entry.modelKey),
      );
      const matchedPricing = pricing.entries
        .filter((entry) => pricingKeys.has(entry.modelKey))
        .map((entry) =>
          cloudProviderModelPricing(
            entry,
            cloudProvider,
            pricing.defaultRegions[cloudProvider],
            pricing.usdPerDbu[cloudProvider],
          ),
        );
      const reasoning = endpoint ? reasoningByModel.get(endpoint) : undefined;

      return {
        ...model,
        taskTypes: tasks.map((task) => task.name),
        useCases: unique(tasks.flatMap((task) => task.useCases)),
        ...(reasoning ? { reasoning } : {}),
        webSearch,
        deprecated: retirements.length > 0,
        retirements,
        pricing: matchedPricing,
      };
    }),
  });
}

function cloudProviderModelPricing(
  entry: DatabricksPricingEntry,
  cloudProvider: DatabricksCloudProvider,
  defaultRegion: string,
  usdPerDbu: number,
): z.infer<typeof DatabricksCloudProviderPricingEntrySchema> {
  return DatabricksCloudProviderPricingEntrySchema.parse({
    ...entry,
    cloudProvider,
    defaultRegion,
    currency: "USD",
    usdPerDbu,
    usdUnit: USD_UNIT_BY_DBU_UNIT[entry.unit],
    usdRates: Object.fromEntries(
      Object.entries(entry.dbuRates).map(([name, rate]) => [
        name,
        rate === null ? null : preciseProduct(rate, usdPerDbu),
      ]),
    ),
  });
}

function parsePricingPage(html: string, sourceUrl: string): DatabricksPricingEntry[] {
  const $ = load(html);
  const entries: DatabricksPricingEntry[] = [];
  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    const title = collapseText($(rows.get(0))).toLowerCase();
    const shape = pricingTableShape(title);
    if (!shape) return;
    const rateHeaders =
      shape.tier === "batch"
        ? ["dbuPerHour"]
        : rowCells($(rows.get(1)), $).map((cell) => rateName(cell.text));
    const dataRows = shape.tier === "batch" ? rows.slice(1) : rows.slice(2);
    let currentModels: string[] = [];

    dataRows.each((__, row) => {
      const cells = rowCells($(row), $).map((cell) => cell.text);
      const descriptorCount = cells.length - rateHeaders.length;
      if (descriptorCount < 1) return;
      const descriptors = cells.slice(0, descriptorCount);
      const continuation = pricingCondition(descriptors[0]);
      let condition: string | undefined;
      if (continuation && descriptors.length === 1) {
        condition = continuation;
      } else {
        currentModels = pricingModelLabels(descriptors[0]);
        condition = pricingCondition(descriptors[1]);
      }
      if (currentModels.length === 0) return;
      const values = cells.slice(-rateHeaders.length);
      const dbuRates = Object.fromEntries(
        rateHeaders.map((header, index) => [header, decimal(values[index])]),
      );
      for (const modelLabel of currentModels) {
        entries.push({
          sourceUrl,
          modelLabel,
          modelKey: normalizeModelKey(modelLabel),
          tier: shape.tier,
          unit: shape.unit,
          ...(condition ? { condition } : {}),
          dbuRates,
        });
      }
    });
  });
  return entries;
}

function pricingTableShape(title: string):
  | {
      readonly tier: z.infer<typeof DatabricksPricingTierSchema>;
      readonly unit: z.infer<typeof DatabricksPricingUnitSchema>;
    }
  | undefined {
  if (title.includes("pay per token") && title.includes("dbu per 1m tokens")) {
    return {
      tier: title.includes("priority") ? "priority" : "standard",
      unit: "dbu-per-million-tokens",
    };
  }
  if (title.includes("provisioned throughput") && title.includes("dbu per hour")) {
    return {
      tier: "provisioned",
      unit: "dbu-per-hour-per-50-model-units",
    };
  }
  if (title.includes("batch inference") && title.includes("dbu per hour")) {
    return { tier: "batch", unit: "dbu-per-hour" };
  }
  return undefined;
}

function pricingModelLabels(value: string | undefined): string[] {
  if (!value) return [];
  const clean = value.replace(/[＊*⌖]+/g, "").trim();
  const parts = clean.split(",").map((part) => part.trim()).filter(Boolean);
  const firstVersion = /\bV?\d+(?:\.\d+)*/i.exec(parts[0] ?? "");
  const prefix = firstVersion ? parts[0]!.slice(0, firstVersion.index) : "";
  return unique(
    parts.map((part, index) => {
      if (index === 0 || !prefix || !/^V?\d/i.test(part)) return part;
      return `${prefix}${part}`;
    }),
  );
}

function pricingCondition(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = cleanText(value).toLowerCase();
  return PRICING_CONDITIONS.has(normalized) ? slug(normalized) : undefined;
}

function rateName(value: string): string {
  const normalized = cleanText(value).toLowerCase();
  const names: Record<string, string> = {
    input: "input",
    output: "output",
    "cache read": "cacheRead",
    "cache write": "cacheWrite",
    "cache write (1hr)": "cacheWriteOneHour",
    "on-demand": "onDemand",
    "1 month reservation": "oneMonthReservation",
    "3 month reservation": "threeMonthReservation",
  };
  return names[normalized] ?? slug(normalized);
}

function databricksCalculatorAssetUrl(html: string, pageUrl: string): string {
  const script = load(html)("#gatsby-chunk-mapping").text();
  const assignment = script.match(/window\.___chunkMapping=("(?:\\.|[^"\\])*")/);
  if (!assignment?.[1]) {
    throw new Error("Databricks pricing calculator chunk mapping was missing");
  }
  const serialized: unknown = JSON.parse(assignment[1]);
  if (typeof serialized !== "string") {
    throw new Error("Databricks pricing calculator chunk mapping was invalid");
  }
  const mapping = z.record(z.string(), z.array(z.string())).parse(JSON.parse(serialized));
  const path = mapping[GENAI_CALCULATOR_COMPONENT]?.[0];
  if (!path) {
    throw new Error("Databricks pricing calculator asset was missing");
  }
  return new URL(`/en-pricing-assets${path}`, pageUrl).toString();
}

function parseDatabricksCloudProviderPricing(
  calculatorJavascript: string,
): {
  readonly defaultRegions: z.infer<typeof DatabricksDefaultRegionsSchema>;
  readonly usdPerDbu: z.infer<typeof DatabricksUsdPerDbuSchema>;
} {
  const defaults = calculatorJavascript.match(
    /\{aws:"([^"]+)",gcp:"([^"]+)",azure:"([^"]+)"\}/,
  );
  if (!defaults) {
    throw new Error("Databricks pricing calculator default regions were missing");
  }
  const defaultRegions = DatabricksDefaultRegionsSchema.parse({
    [DatabricksCloudProvider.Aws]: defaults[1],
    [DatabricksCloudProvider.Gcp]: defaults[2],
    [DatabricksCloudProvider.Azure]: defaults[3],
  });
  const RegionSchema = z.looseObject({
    key: z.string(),
    cloud: DatabricksCloudProviderSchema,
    rate: z.number().nonnegative(),
  });
  for (const match of calculatorJavascript.matchAll(/JSON\.parse\('(\[.*?\])'\)/gs)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1] ?? "");
    } catch {
      continue;
    }
    const regions = z.array(RegionSchema).safeParse(parsed);
    if (!regions.success) continue;
    const byKey = new Map(regions.data.map((region) => [region.key, region]));
    const result = Object.fromEntries(
      DATABRICKS_CLOUD_PROVIDERS.flatMap((cloudProvider) => {
        const region = byKey.get(defaultRegions[cloudProvider]);
        return region?.cloud === cloudProvider
          ? [[cloudProvider, region.rate] as const]
          : [];
      }),
    );
    if (Object.keys(result).length === DATABRICKS_CLOUD_PROVIDERS.length) {
      return {
        defaultRegions,
        usdPerDbu: DatabricksUsdPerDbuSchema.parse(result),
      };
    }
  }
  throw new Error(
    "Databricks pricing calculator cloud provider USD-per-DBU rates were missing",
  );
}

function parseDocumentationSections(
  $: CheerioAPI,
  sourceUrl: string,
): z.infer<typeof DatabricksDocumentationSectionSchema>[] {
  return $("h2, h3")
    .toArray()
    .flatMap((heading) => {
      const section = $(heading);
      const title = collapseText(section);
      if (!title || title === "In this article" || title === "Feedback") return [];
      const level = Number(nodeTagName(section.get(0))?.slice(1));
      const nodes = siblingSection(section);
      return [
        {
          id: section.attr("id") ?? slug(title),
          title,
          level,
          paragraphs: unique(nodes.flatMap((node) => paragraphTexts(node, $))),
          listItems: unique(
            nodes.flatMap((node) =>
              node.find("li").toArray().map((item) => collapseText($(item))),
            ),
          ),
          codeBlocks: unique(
            nodes.flatMap((node) =>
              node.find("pre").toArray().map((block) => cleanText($(block).text())),
            ),
          ),
          links: linksFrom(nodes, $, sourceUrl),
        },
      ];
    });
}

function pageMetadata($: CheerioAPI, sourceUrl: string) {
  const modified =
    $("meta[property='article:modified_time']").attr("content") ??
    $("meta[name='updated_at']").attr("content") ??
    $("time[datetime]").first().attr("datetime");
  const parsedDate = modified ? flexibleDateSchema.safeParse(modified) : undefined;
  return {
    sourceUrl,
    ...optional("canonicalUrl", $("link[rel='canonical']").attr("href")),
    title: cleanText($("h1").first().text() || $("title").text()),
    ...optional("description", $("meta[name='description']").attr("content")),
    ...(parsedDate?.success ? { lastUpdated: parsedDate.data } : {}),
  };
}

function rowCells(row: Selection, $: CheerioAPI): { readonly text: string }[] {
  return row
    .find("th, td")
    .toArray()
    .map((cell) => ({ text: collapseText($(cell)) }));
}

function retirementSchedules(
  cell: Selection,
  $: CheerioAPI,
): z.infer<typeof DatabricksRetirementScheduleSchema>[] {
  const blocks = cell.find("p, li").toArray();
  const selections = blocks.length > 0 ? blocks.map((block) => $(block)) : [cell];
  return uniqueBy(
    selections.flatMap((selection) => {
      const text = collapseText(selection);
      if (!text) return [];
      const label = cleanText(selection.find("strong").first().text()).replace(/:$/, "");
      return [
        {
          offering: label || "all",
          text,
          dates: datesFromText(text),
        },
      ];
    }),
    (schedule) => `${schedule.offering}|${schedule.text}`,
  );
}

function datesFromText(value: string): Date[] {
  const matches = value.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/gi,
  );
  return uniqueBy(
    (matches ?? []).flatMap((match) => {
      const date = parseFlexibleDate(match);
      return date ? [date] : [];
    }),
    (date) => date.toISOString(),
  );
}

function siblingSection(heading: Selection): Selection[] {
  const level = headingLevel(nodeTagName(heading.get(0)));
  const nodes: Selection[] = [];
  let sibling = heading.next();
  while (sibling.length > 0) {
    const siblingLevel = headingLevel(nodeTagName(sibling.get(0)));
    if (siblingLevel !== undefined && siblingLevel <= level) break;
    nodes.push(sibling);
    sibling = sibling.next();
  }
  return nodes;
}

function contentBetween(
  start: Selection,
  end: Selection,
  $: CheerioAPI,
): string[] {
  const content: string[] = [];
  let sibling = start.next();
  while (sibling.length > 0 && sibling.get(0) !== end.get(0)) {
    content.push(...paragraphTexts(sibling, $));
    sibling.find("li").each((_, item) => {
      content.push(collapseText($(item)));
    });
    sibling = sibling.next();
  }
  return unique(content);
}

function paragraphTexts(node: Selection, $: CheerioAPI): string[] {
  const paragraphs = node.is("p") ? [collapseText(node)] : [];
  node.find("p").each((_, paragraph) => {
    paragraphs.push(cleanText($(paragraph).text()));
  });
  return paragraphs.filter(Boolean);
}

function parseNotices(
  node: Selection,
  $: CheerioAPI,
  sourceUrl: string,
): z.infer<typeof DatabricksNoticeSchema>[] {
  const className = node.attr("class") ?? "";
  if (!/admonition|\bNOTE\b|\bIMPORTANT\b|\bWARNING\b|\bTIP\b|\bCAUTION\b|\bINFO\b/i.test(className)) {
    return [];
  }
  const kind =
    /theme-admonition-([a-z]+)/i.exec(className)?.[1]?.toLowerCase() ??
    (/\b(NOTE|IMPORTANT|WARNING|TIP|CAUTION|INFO)\b/i
      .exec(className)?.[1]
      ?.toLowerCase() ?? "notice");
  const heading = node
    .find("[class*='admonitionHeading']")
    .first()
    .add(node.children("strong").first())
    .first();
  const paragraphs = paragraphTexts(node, $);
  const firstParagraph = paragraphs[0];
  const structuralTitle =
    collapseText(heading) ||
    (firstParagraph && isNoticeLabel(firstParagraph) ? firstParagraph : "");
  const listItems = node
    .find("li")
    .toArray()
    .map((item) => collapseText($(item)));
  const text = unique([...paragraphs, ...listItems])
    .filter((value) => !isNoticeLabel(value))
    .join(" ") || stripNoticeLabel(collapseText(node));
  const title =
    structuralTitle && !sameText(structuralTitle, kind)
      ? structuralTitle
      : undefined;
  return [
    {
      kind,
      ...(title ? { title } : {}),
      text,
      links: linksFrom([node], $, sourceUrl),
    },
  ];
}

function isNoticeLabel(value: string): boolean {
  return /^(?:note|important|warning|tip|caution|info)$/i.test(value.trim());
}

function stripNoticeLabel(value: string): string {
  return value.replace(/^(?:note|important|warning|tip|caution|info)\s*/i, "");
}

function sameText(left: string, right: string): boolean {
  return cleanText(left).toLowerCase() === cleanText(right).toLowerCase();
}

function codeValuesFrom(nodes: readonly Selection[], $: CheerioAPI): string[] {
  return unique(
    nodes.flatMap((node) => {
      const own = node.is("code") ? [collapseText(node)] : [];
      return [
        ...own,
        ...node
          .find("code")
          .toArray()
          .map((code) => collapseText($(code))),
      ];
    }),
  ).filter(Boolean);
}

function linksFrom(
  nodes: readonly Selection[],
  $: CheerioAPI,
  sourceUrl: string,
): z.infer<typeof DatabricksLinkSchema>[] {
  const links = nodes.flatMap((node) =>
    node
      .find("a[href]")
      .toArray()
      .flatMap((anchor) => {
        const href = $(anchor).attr("href");
        if (!href || href.startsWith("javascript:")) return [];
        try {
          return [
            {
              text: collapseText($(anchor)),
              url: new URL(href, sourceUrl).toString(),
            },
          ];
        } catch {
          return [];
        }
      }),
  );
  return uniqueBy(links, (link) => `${link.text}|${link.url}`);
}

function labeledCode(
  paragraphs: readonly string[],
  nodes: readonly Selection[],
  label: string,
  $: CheerioAPI,
): string | undefined {
  const paragraphIndex = paragraphs.findIndex((paragraph) => paragraph.startsWith(label));
  if (paragraphIndex < 0) return undefined;
  for (const node of nodes) {
    const paragraph = node.is("p") ? node : node.find("p");
    for (const element of paragraph.toArray()) {
      const selection = $(element);
      if (!collapseText(selection).startsWith(label)) continue;
      const code = cleanText(selection.find("code").first().text());
      return code || collapseText(selection).slice(label.length).trim();
    }
  }
  return paragraphs[paragraphIndex]?.slice(label.length).trim();
}

function labeledText(
  paragraphs: readonly string[],
  label: string,
): string | undefined {
  const paragraph = paragraphs.find((value) => value.startsWith(label));
  return paragraph?.slice(label.length).trim();
}

function reasoningLevels(
  value: string,
): z.infer<typeof DatabricksReasoningLevelSchema>[] {
  const fragments = [
    ...value.matchAll(/accepted values are ([^.]+)/gi),
    ...value.matchAll(/accepts ([^.]+)/gi),
  ].flatMap((match) => match[1] ?? []);
  return unique(
    fragments.flatMap((fragment) =>
      fragment
        .split(/,|\bor\b|\band\b/gi)
        .map((level) => level.replace(/^(?:one of|the values?)\s+/i, ""))
        .map(slug)
        .filter(Boolean),
    ),
  );
}

function defaultReasoningLevel(
  value: string,
): z.infer<typeof DatabricksReasoningLevelSchema> | undefined {
  const patterns = [
    /default(?:s| is)?(?: set)? to\s+["'`]?([a-z]+)/i,
    /([a-z]+)\s*\(default\)/i,
    /uses\s+["'`]?([a-z]+)["'`]?\s+when you omit/i,
  ];
  for (const pattern of patterns) {
    const level = pattern.exec(value)?.[1]?.toLowerCase();
    if (level) return slug(level);
  }
  return undefined;
}

function reasoningCanDisable(value: string): boolean | undefined {
  if (/cannot be disabled|always uses|reasoning cannot be disabled/i.test(value)) return false;
  if (/can be disabled|disable it|disabled thinking/i.test(value)) return true;
  return undefined;
}

function modelAliases(
  model: z.infer<typeof DatabricksSupportedModelSchema>,
): Set<string> {
  const aliases = new Set(
    [model.name, model.endpointName, model.modelServiceName]
      .filter((value): value is string => Boolean(value))
      .map(normalizeModelKey),
  );
  const pending = [...aliases];
  while (pending.length > 0) {
    const alias = pending.pop();
    if (!alias) continue;
    const variants = [
      alias.replace(/-instruct$/, ""),
      alias.replace(/-en$/, ""),
      alias.replace(/-a\d+b$/, ""),
      alias.replace(/-0$/, ""),
    ];
    for (const variant of variants) {
      if (variant === alias || aliases.has(variant)) continue;
      aliases.add(variant);
      pending.push(variant);
    }
  }
  return aliases;
}

function aliasesIncludeIdentity(
  aliases: ReadonlySet<string>,
  identity: string,
): boolean {
  const key = normalizeModelKey(identity);
  return (
    aliases.has(key) ||
    [...aliases].some(
      (alias) => alias.endsWith(`-${key}`) || key.endsWith(`-${alias}`),
    )
  );
}

function matchingPricingKeys(
  aliases: ReadonlySet<string>,
  pricingKeys: readonly string[],
): Set<string> {
  const uniqueKeys = unique(pricingKeys);
  const directMatches = uniqueKeys.filter((pricingKey) =>
    [...aliases].some(
      (alias) =>
        alias === pricingKey ||
        alias.endsWith(`-${pricingKey}`) ||
        alias.includes(`-${pricingKey}-`) ||
        withoutVersionZero(alias).endsWith(`-${withoutVersionZero(pricingKey)}`),
    ),
  );
  if (directMatches.length > 0) return mostSpecificKeys(directMatches);

  const tokenMatches = uniqueKeys.filter((pricingKey) =>
    [...aliases].some((alias) => hasSameModelTokens(pricingKey, alias)),
  );
  return mostSpecificKeys(tokenMatches);
}

function mostSpecificKeys(keys: readonly string[]): Set<string> {
  const size = Math.max(0, ...keys.map((key) => comparableTokens(key).length));
  return new Set(keys.filter((key) => comparableTokens(key).length === size));
}

function comparableTokens(value: string): string[] {
  return value.split("-").filter((token) => token && token !== "0");
}

function withoutVersionZero(value: string): string {
  return comparableTokens(value).join("-");
}

function hasSameModelTokens(pricingKey: string, alias: string): boolean {
  const expected = comparableTokens(pricingKey);
  const candidate = comparableTokens(alias);
  if (expected.length === 0) return false;
  if (expected.length === 1 && candidate[0] === expected[0]) return true;
  const start = candidate.indexOf(expected[0]!);
  if (start < 0) return false;
  const actual = candidate.slice(start);
  if (actual.length !== expected.length) return false;
  return [...actual].sort().join("-") === [...expected].sort().join("-");
}

function normalizeModelKey(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/^system\.ai[.-]/, "")
    .replace(/^databricks-/, "")
    .replace(/([a-z])(\d)/g, "$1-$2")
    .replace(/(\d)([a-z])/g, "$1-$2")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function modelStatus(
  value: string,
): z.infer<typeof DatabricksSupportedModelStatusSchema> {
  if (value.includes("legacy")) return "legacy";
  if (value.includes("preview")) return "preview";
  if (value.includes("beta")) return "beta";
  return "general-availability";
}

function splitList(value: string | undefined): string[] {
  return value
    ? unique(value.split(",").map((part) => cleanText(part)).filter(Boolean))
    : [];
}

function decimal(value: string | undefined): number | null {
  if (!value || value.trim() === "-") return null;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function preciseProduct(left: number, right: number): number {
  return Number((left * right).toFixed(12));
}

function headingLevel(name: string | undefined): number {
  const level = /^h([1-6])$/.exec(name ?? "")?.[1];
  return level ? Number(level) : Number.POSITIVE_INFINITY;
}

function nodeTagName(node: unknown): string | undefined {
  if (!node || typeof node !== "object" || !("tagName" in node)) return undefined;
  return typeof node.tagName === "string" ? node.tagName : undefined;
}

function collapseText(selection: Selection | undefined): string {
  return selection ? cleanText(selection.text()) : "";
}

function cleanText(value: string): string {
  return value.replace(/\u200b/g, "").split(/\s+/).filter(Boolean).join(" ");
}

function slug(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function optional<Key extends string>(
  key: Key,
  value: string | undefined,
): { readonly [Property in Key]?: string } {
  return value ? ({ [key]: value } as { [Property in Key]: string }) : {};
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}
