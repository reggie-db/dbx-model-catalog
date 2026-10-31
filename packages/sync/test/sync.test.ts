import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  buildModelCatalog,
  CatalogSync,
  ClientSyncService,
  databricksCatalogSchema,
  DATABRICKS_CLOUD_PROVIDERS,
  DATABRICKS_CLOUD_PROVIDER_DOCS_URLS,
  DATABRICKS_FOUNDATION_MODEL_PRICING_URL,
  DATABRICKS_GENAI_PRICING_CALCULATOR_URL,
  DATABRICKS_PROPRIETARY_MODEL_PRICING_URL,
  DatabricksSupportedModelSchema,
  DatabricksSyncClient,
  flexibleDateSchema,
  type Fetcher,
  type LMArenaCatalogData,
  lmArenaSchema,
  type LiveBenchCatalogData,
  liveBenchSchema,
  LiveBenchSyncClient,
  modelParamsSchema,
  modelsDevSchema,
  parseDatabricksSupportedModelsPage,
  parseFlexibleDate,
  SyncClient,
  syncClientCachePath,
  stringifyJson,
} from "../src/index.ts";

class TestSyncClient<TData> extends SyncClient<TData> {
  protected readonly schema = z.custom<TData>();

  public constructor(private readonly value: TData) {
    super({ cacheEnabled: false });
  }

  public read(): Promise<TData> {
    return Promise.resolve(this.value);
  }
}

class CachedTestSyncClient extends SyncClient<string> {
  protected readonly schema = z.string();
  public calls = 0;

  public async read(): Promise<string> {
    return this.cacheGetOrSet("https://example.com/value", async () => {
      this.calls += 1;
      await Bun.sleep(5);
      return `value-${this.calls}`;
    });
  }
}

describe("SyncClient cache", () => {
  test("coalesces loads, locks its file, and refreshes after TTL", async () => {
    const cacheDirectory = mkdtempSync(
      join(tmpdir(), "dbx-model-catalog-test-"),
    );
    try {
      const client = new CachedTestSyncClient({
        cacheDirectory,
        cacheName: "test",
        cacheTtl: 10,
      });
      const values = await Promise.all([
        client.read(),
        client.read(),
        client.read(),
      ]);
      const cachePath = syncClientCachePath("test", cacheDirectory);

      expect(values).toEqual(["value-1", "value-1", "value-1"]);
      expect(client.calls).toBe(1);
      expect(existsSync(cachePath)).toBe(true);
      expect(existsSync(`${cachePath}.lock`)).toBe(true);

      await Bun.sleep(20);
      expect(await client.read()).toBe("value-2");
      expect(client.calls).toBe(2);
    } finally {
      rmSync(cacheDirectory, { recursive: true, force: true });
    }
  });

  test("uses stable per-client cache filenames", () => {
    expect(syncClientCachePath("ModelsDevSyncClient", "/tmp/cache")).toBe(
      "/tmp/cache/models-dev.json",
    );
    expect(syncClientCachePath("LMArenaSyncClient", "/tmp/cache")).toBe(
      "/tmp/cache/lm-arena.json",
    );
  });
});

describe("SyncService", () => {
  test("wraps the source payload in a timestamped result", async () => {
    const service = new ClientSyncService(
      "models.dev",
      new TestSyncClient({ models: 3 }),
    );
    const result = await service.sync();

    expect(result.source).toBe("models.dev");
    expect(result.data).toEqual({ models: 3 });
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);
  });
});

describe("CatalogSync", () => {
  test("returns the normalized common catalog", async () => {
    const lmArenaData: LMArenaCatalogData = {
      dataset: "lmarena-ai/leaderboard-dataset",
      split: "latest",
      metadata: [],
      configurations: {},
    };
    const liveBenchData: LiveBenchCatalogData = {
      dataset: "LiveBench/livebench.github.io",
      release: "2026-06-25",
      metadata: [],
      categories: {},
      rows: [],
    };
    const databricksData = databricksCatalogSchema.parse({
      pricing: {
        sourceUrls: [],
        defaultRegions: {
          aws: "aws-default",
          azure: "azure-default",
          gcp: "gcp-default",
        },
        usdPerDbu: { aws: 0.1, azure: 0.2, gcp: 0.3 },
        entries: [],
      },
      cloudProviders: Object.fromEntries(
        DATABRICKS_CLOUD_PROVIDERS.map((cloudProvider) => [
          cloudProvider,
          {
            cloudProvider,
            supportedModels: {
              metadata: { sourceUrl: "https://example.com", title: "Models" },
              introduction: [],
              models: [],
              additionalResources: [],
            },
            scoreFoundationModels: {
              metadata: { sourceUrl: "https://example.com", title: "Score" },
              introduction: [],
              queryMethods: [],
              taskTypes: [],
              sections: [],
            },
            webSearch: {
              metadata: { sourceUrl: "https://example.com", title: "Web search" },
              introduction: [],
              models: [],
              modelGroups: [],
            },
            retiredModelsPolicy: {
              metadata: { sourceUrl: "https://example.com", title: "Retired models" },
              introduction: [],
              models: [],
              sections: [],
            },
          },
        ]),
      ),
    });
    const sync = new CatalogSync(
      new ClientSyncService(
        "models.dev",
        new TestSyncClient({
          provider: {
            id: "provider",
            env: [],
            npm: "@example/provider",
            name: "Provider",
            doc: "https://example.com/docs",
            models: {},
          },
        }),
      ),
      new ClientSyncService(
        "modelparams.dev",
        new TestSyncClient({
          $schema: "https://example.com/schema.json",
          generatedAt: new Date("2026-10-30T00:00:00.000Z"),
          count: 0,
          models: [],
        }),
      ),
      new ClientSyncService("lm-arena", new TestSyncClient(lmArenaData)),
      new ClientSyncService("livebench", new TestSyncClient(liveBenchData)),
      new ClientSyncService("databricks", new TestSyncClient(databricksData)),
    );

    const result = await sync.syncAll();

    expect(result.schema_version).toBe(11);
    expect(result.models).toEqual({});
    expect(result.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("LiveBenchSyncClient", () => {
  test("discovers and reads the latest complete leaderboard release", async () => {
    const repositoryFile = (name: string) => ({
      name,
      path: `public/${name}`,
      sha: name,
      size: 10,
      type: "file",
      download_url: `https://example.com/${name}`,
    });
    const fetcher: Fetcher = async (input) => {
      const url = input.toString();
      if (url.includes("api.github.com")) {
        return Response.json([
          repositoryFile("categories_2026_01_01.json"),
          repositoryFile("table_2026_01_01.csv"),
          repositoryFile("categories_2026_02_01.json"),
          repositoryFile("table_2026_02_01.csv"),
          repositoryFile("table_2026_03_01.csv"),
        ]);
      }
      if (url.endsWith("categories_2026_02_01.json")) {
        return Response.json({ Reasoning: ["logic"], Coding: ["code"] });
      }
      if (url.endsWith("table_2026_02_01.csv")) {
        return new Response('model,logic,code\n"GPT Test, Preview",90,80\n');
      }
      return new Response("Not found", { status: 404, statusText: "Not Found" });
    };

    const result = await new LiveBenchSyncClient(fetcher, {
      cacheEnabled: false,
    }).read();

    expect(result.release).toBe("2026-02-01");
    expect(result.categories).toEqual({
      Reasoning: ["logic"],
      Coding: ["code"],
    });
    expect(result.rows).toEqual([
      { model: "GPT Test, Preview", scores: { logic: 90, code: 80 } },
    ]);
  });
});

describe("Databricks notice parsing", () => {
  test("separates structural labels from notice paragraphs across doc sites", () => {
    const modelSection = (notice: string) => `
      <h2 id="gpt-test">OpenAI GPT Test</h2>
      <p>Model service name: <code>system.ai.gpt-test</code></p>
      <p>Endpoint name: <code>databricks-gpt-test</code></p>
      ${notice}
    `;
    const aws = parseDatabricksSupportedModelsPage(
      modelSection(`
        <div class="theme-admonition theme-admonition-important">
          <div class="admonitionHeading">important</div>
          <div class="admonitionContent">
            <p>Customers must follow the usage policy.</p>
            <p>For this model, prompts are retained for 30 days.</p>
          </div>
        </div>
      `),
      "https://docs.databricks.com/aws/en/supported-models",
    );
    const azure = parseDatabricksSupportedModelsPage(
      modelSection(`
        <div class="IMPORTANT">
          <p>Important</p>
          <p>Customers must follow the usage policy.</p>
          <p>For this model, prompts are retained for 30 days.</p>
        </div>
      `),
      "https://learn.microsoft.com/azure/databricks/supported-models",
    );
    const expected = {
      kind: "important",
      text: "Customers must follow the usage policy. For this model, prompts are retained for 30 days.",
      links: [],
    };

    expect(aws.models[0]?.notices).toEqual([expected]);
    expect(azure.models[0]?.notices).toEqual([expected]);
  });
});

describe("DatabricksSyncClient", () => {
  test("reads cloud provider docs, reasoning details, task types, and pricing", async () => {
    const supportedModelsHtml = `
      <html>
        <head>
          <link rel="canonical" href="https://example.com/supported-models">
          <meta name="description" content="Supported model reference">
          <meta property="article:modified_time" content="2026-10-30">
        </head>
        <body>
          <h1>Supported models</h1>
          <p>Models available for pay-per-token serving.</p>
          <h2 id="gpt-test">OpenAI GPT Test</h2>
          <p>Model service name: <code>system.ai.gpt-test</code></p>
          <p>Endpoint name: <code>databricks-gpt-test</code></p>
          <p>Supported inputs: Text, Images</p>
          <p>Publisher: Future Models Inc.</p>
          <p>Status: Experimental</p>
          <p>A model for code and document analysis.</p>
          <div class="theme-admonition-note">
            <strong>Note</strong>
            <p>This model is in Preview.</p>
          </div>
          <h2 id="additional-resources">Additional resources</h2>
          <ul><li><a href="/guide">Serving guide</a></li></ul>
        </body>
      </html>
    `;
    const scoreModelsHtml = `
      <html><body>
        <h1>Score foundation models</h1>
        <p>Query hosted and external models.</p>
        <h2 id="query-methods">Query methods</h2>
        <table>
          <tr><th>Method</th><th>Details</th></tr>
          <tr><td>OpenAI client</td><td><a href="/openai">Use the OpenAI API</a></td></tr>
        </table>
        <h2 id="task-types">Supported task types</h2>
        <table>
          <tr><th>Task type</th><th>Description</th><th>Supported models</th><th>Example use cases</th></tr>
          <tr>
            <td>Chat completion</td>
            <td>Generate conversational responses.</td>
            <td><ul><li><code>databricks-gpt-test</code></li><li>external-gpt-test</li></ul></td>
            <td><ul><li>Code generation</li><li>Document analysis</li></ul></td>
          </tr>
        </table>
      </body></html>
    `;
    const reasoningModelsHtml = `
      <table>
        <tr><th>Models</th><th>Reasoning model type</th><th>Details</th><th>Parameters</th></tr>
        <tr>
          <td><code>databricks-gpt-test</code></td>
          <td>Reasoning effort</td>
          <td>Reasoning can be disabled.</td>
          <td>Accepted values are low, medium, high. Defaults to medium.</td>
        </tr>
      </table>
    `;
    const webSearchHtml = `
      <html><body>
        <h1>Web search on Databricks</h1>
        <p>Use grounded web results from supported hosted models.</p>
        <h2 id="supported-models">Supported models</h2>
        <h3 id="future-models">Future models</h3>
        <p><code>system.ai.gpt-test</code></p>
        <h2 id="web-search-through-mcp">Web search through MCP</h2>
        <p><code>system.ai.unrelated-mcp-model</code></p>
      </body></html>
    `;
    const retiredModelsHtml = `
      <html><body>
        <h1>Foundation model lifecycle</h1>
        <p>Databricks retires models as newer versions become available.</p>
        <table>
          <tr><th>Other</th><th>Date</th></tr>
          <tr><td>Ignore this model</td><td>January 1, 2026</td></tr>
        </table>
        <h2 id="partner-models">Partner models</h2>
        <table>
          <tr>
            <th>Partner model</th>
            <th>Retirement date</th>
            <th>Recommended replacement model</th>
          </tr>
          <tr>
            <td>OpenAI GPT Test / OpenAI GPT Test Alias</td>
            <td>
              <p><strong>Pay-per-token:</strong> July 16, 2026</p>
              <p><strong>Provisioned throughput:</strong> October 2, 2026</p>
            </td>
            <td><a href="/replacement">OpenAI GPT Test 2</a></td>
          </tr>
          <tr>
            <td>OpenAI GPT Test / OpenAI GPT Test Alias</td>
            <td>
              <p><strong>Pay-per-token:</strong> July 16, 2026</p>
              <p><strong>Provisioned throughput:</strong> October 2, 2026</p>
            </td>
            <td><a href="/replacement">OpenAI GPT Test 2</a></td>
          </tr>
        </table>
      </body></html>
    `;
    const pricingHtml = `
      <table>
        <tr><th rowspan="2">Model</th><th colspan="2">Pay per token (DBU per 1M tokens)</th></tr>
        <tr><th>Input</th><th>Output</th></tr>
        <tr><td>GPT Test, GPT Plus</td><td>1</td><td>2</td></tr>
        <tr><td>Long context</td><td>3</td><td>4</td></tr>
      </table>
    `;
    const calculatorAssetPath = "/calculator.js";
    const calculatorAssetUrl = new URL(
      `/en-pricing-assets${calculatorAssetPath}`,
      DATABRICKS_GENAI_PRICING_CALCULATOR_URL,
    ).toString();
    const calculatorHtml = `<script id="gatsby-chunk-mapping">window.___chunkMapping="{\\"component---src-pages-product-pricing-genai-pricing-calculator-tsx\\":[\\"${calculatorAssetPath}\\"]}"</script>`;
    const calculatorJavascript = `
      const defaults={aws:"aws-default",gcp:"gcp-default",azure:"azure-default"};
      JSON.parse('[{"key":"aws-default","cloud":"aws","rate":0.1},{"key":"azure-default","cloud":"azure","rate":0.2},{"key":"gcp-default","cloud":"gcp","rate":0.3}]');
    `;
    const pages = new Map<string, string>([
      [DATABRICKS_FOUNDATION_MODEL_PRICING_URL, pricingHtml],
      [DATABRICKS_PROPRIETARY_MODEL_PRICING_URL, "<html></html>"],
      [DATABRICKS_GENAI_PRICING_CALCULATOR_URL, calculatorHtml],
      [calculatorAssetUrl, calculatorJavascript],
    ]);
    for (const cloudProvider of DATABRICKS_CLOUD_PROVIDERS) {
      const urls = DATABRICKS_CLOUD_PROVIDER_DOCS_URLS[cloudProvider];
      pages.set(urls.supportedModels, supportedModelsHtml);
      pages.set(urls.scoreFoundationModels, scoreModelsHtml);
      pages.set(urls.reasoningModels, reasoningModelsHtml);
      pages.set(urls.webSearch, webSearchHtml);
      pages.set(urls.retiredModelsPolicy, retiredModelsHtml);
    }
    const fetcher: Fetcher = async (input) => {
      const url = input.toString();
      const body = pages.get(url);
      return body === undefined
        ? new Response("Not found", { status: 404, statusText: "Not Found" })
        : new Response(body);
    };

    const data = await new DatabricksSyncClient(fetcher, {
      cacheEnabled: false,
    }).read();

    expect(Object.keys(data.cloudProviders)).toEqual(["aws", "azure", "gcp"]);
    const azureModel = data.cloudProviders.azure.supportedModels.models[0];
    expect(azureModel?.name).toBe("OpenAI GPT Test");
    expect(azureModel?.publisher).toBe("Future Models Inc.");
    expect(azureModel?.supportedInputs).toEqual(["Text", "Images"]);
    expect(azureModel?.status).toBe("experimental");
    expect(azureModel?.taskTypes).toEqual(["Chat completion"]);
    expect(azureModel?.useCases).toEqual(["Code generation", "Document analysis"]);
    expect(azureModel?.reasoning?.levels).toEqual(["low", "medium", "high"]);
    expect(azureModel?.reasoning?.defaultLevel).toBe("medium");
    expect(azureModel?.reasoning?.canDisable).toBe(true);
    expect(azureModel?.webSearch).toBe(true);
    expect(azureModel?.deprecated).toBe(true);
    expect(azureModel?.retirements[0]?.names).toEqual([
      "OpenAI GPT Test",
      "OpenAI GPT Test Alias",
    ]);
    expect(azureModel?.retirements[0]?.schedules).toEqual([
      {
        offering: "Pay-per-token",
        text: "Pay-per-token: July 16, 2026",
        dates: [new Date("2026-07-16T00:00:00.000Z")],
      },
      {
        offering: "Provisioned throughput",
        text: "Provisioned throughput: October 2, 2026",
        dates: [new Date("2026-10-02T00:00:00.000Z")],
      },
    ]);
    expect(azureModel?.retirements[0]?.replacementText).toBe("OpenAI GPT Test 2");
    expect(azureModel?.retirements[0]?.links[0]?.url).toBe(
      "https://learn.microsoft.com/replacement",
    );
    expect(data.cloudProviders.azure.retiredModelsPolicy.models).toHaveLength(1);
    expect(azureModel?.pricing).toHaveLength(2);
    expect(azureModel?.pricing[0]?.defaultRegion).toBe("azure-default");
    expect(azureModel?.pricing[0]?.cloudProvider).toBe("azure");
    expect(azureModel?.pricing[0]?.currency).toBe("USD");
    expect(azureModel?.pricing[0]?.dbuRates).toEqual({ input: 1, output: 2 });
    expect(azureModel?.pricing[0]?.usdPerDbu).toBe(0.2);
    expect(azureModel?.pricing[0]?.usdUnit).toBe("usd-per-million-tokens");
    expect(azureModel?.pricing[0]?.usdRates).toEqual({ input: 0.2, output: 0.4 });
    expect(azureModel?.pricing[1]?.condition).toBe("long-context");
    expect(
      data.cloudProviders.aws.supportedModels.models[0]?.pricing[0]?.usdRates,
    ).toEqual({ input: 0.1, output: 0.2 });
    expect(
      data.cloudProviders.gcp.supportedModels.models[0]?.pricing[0]?.usdRates,
    ).toEqual({ input: 0.3, output: 0.6 });
    expect(data.pricing.entries.map((entry) => entry.modelLabel)).toEqual([
      "GPT Test",
      "GPT Plus",
      "GPT Test",
      "GPT Plus",
    ]);
    expect(
      data.cloudProviders.aws.scoreFoundationModels.queryMethods[0]?.links[0]?.url,
    ).toBe("https://docs.databricks.com/openai");
    expect(data.cloudProviders.aws.webSearch.models).toEqual([
      "system.ai.gpt-test",
    ]);

    const shortPolicy = {
      kind: "important",
      title: "important",
      text: "importantCustomers must follow Anthropic's usage policy.",
      links: [],
    };
    const retainedPrompts = {
      kind: "important",
      title: "important",
      text: "importantFor GPT Test, prompts are retained for 30 days.",
      links: [],
    };
    data.cloudProviders.aws.supportedModels.models[0]!.notices = [
      shortPolicy,
      retainedPrompts,
    ];
    data.cloudProviders.azure.supportedModels.models[0]!.notices = [
      {
        kind: "important",
        text: "Important Customers must follow Anthropic's usage policy. See also the Databricks agreement.",
        links: [],
      },
      {
        kind: "important",
        text: "Important For GPT Test, prompts are retained for 30 days.",
        links: [],
      },
    ];
    data.cloudProviders.gcp.supportedModels.models[0]!.notices = [
      shortPolicy,
      retainedPrompts,
    ];

    const catalog = buildModelCatalog({
      modelsDev: {
        source: "models.dev",
        fetchedAt: "2026-10-31T12:00:00.000Z",
        data: modelsDevSchema.parse({
          databricks: {
            id: "databricks",
            env: [],
            npm: "@ai-sdk/openai-compatible",
            name: "Databricks",
            doc: "https://docs.databricks.com/",
            models: {
              "databricks-gpt-test": {
                id: "databricks-gpt-test",
                name: "GPT Test",
                description: "Canonical GPT Test metadata.",
                family: "gpt",
                attachment: true,
                reasoning: true,
                tool_call: true,
                structured_output: true,
                release_date: "2026-10-01",
                last_updated: "2026-10-30",
                modalities: { input: ["text", "image"], output: ["text"] },
                open_weights: false,
                limit: { context: 200_000, output: 32_000 },
                canonical_model_id: "openai/gpt-test",
                cost: { input: 999, output: 999 },
              },
            },
          },
        }),
      },
      modelParams: {
        source: "modelparams.dev",
        fetchedAt: "2026-10-31T12:00:01.000Z",
        data: modelParamsSchema.parse({
          $schema: "https://example.com/modelparams.schema.json",
          generatedAt: "2026-10-31",
          count: 1,
          models: [
            {
              provider: "openai",
              authType: "api_key",
              apiSurface: "responses",
              model: "gpt-test",
              params: [
                {
                  path: "reasoning.effort",
                  label: "Reasoning effort",
                  description: "Controls reasoning depth.",
                  group: "reasoning",
                  type: "string",
                  values: ["low", "medium", "high", "xhigh"],
                },
              ],
            },
          ],
        }),
      },
      lmArena: {
        source: "lm-arena",
        fetchedAt: "2026-10-31T12:00:02.000Z",
        data: lmArenaSchema.parse({
          dataset: "lmarena-ai/leaderboard-dataset",
          split: "latest",
          metadata: [],
          configurations: {
            text: {
              rows: [
                {
                  model_name: "GPT Test (High, Codex Harness)",
                  organization: "OpenAI",
                  license: "Proprietary",
                  rating: 1500,
                  rating_lower: 1490,
                  rating_upper: 1510,
                  variance: 10,
                  vote_count: "100",
                  rank: "1",
                  category: "overall",
                  leaderboard_publish_date: "2026-10-30",
                },
              ],
            },
          },
        }),
      },
      liveBench: {
        source: "livebench",
        fetchedAt: "2026-10-31T12:00:02.500Z",
        data: liveBenchSchema.parse({
          dataset: "LiveBench/livebench.github.io",
          release: "2026-10-30",
          metadata: [],
          categories: {
            Reasoning: ["logic"],
            Coding: ["code"],
          },
          rows: [
            {
              model: "gpt-test-20261030-thinking-64k-high-effort",
              scores: { logic: 90, code: 80 },
            },
            {
              model: "unmatched-model",
              scores: { logic: 100, code: 100 },
            },
          ],
        }),
      },
      databricks: {
        source: "databricks",
        fetchedAt: "2026-10-31T12:00:03.000Z",
        data,
      },
    });
    const catalogModel = catalog.models["databricks-gpt-test"];
    expect("id" in (catalogModel ?? {})).toBe(false);
    expect(catalogModel?.aliases).toContain("openai/gpt-test");
    expect(catalogModel?.aliases).not.toContain("databricks-gpt-test");
    expect(catalogModel?.aliases).toContain("system.ai.gpt-test");
    expect(catalogModel).toMatchObject({
      type: "chat",
      publisher: "Future Models Inc.",
      status: "deprecated",
      release_date: "2026-10-01",
      last_updated: "2026-10-30",
      modalities: { input: ["text", "image"], output: ["text"] },
      capabilities: {
        attachments: true,
        tools: true,
        structured_output: true,
        web_search: true,
        reasoning: {
          supported: true,
          effort: ["low", "medium", "high", "xhigh"],
          default_effort: "medium",
          toggle: true,
        },
      },
      limits: { context: 200_000, output: 32_000 },
      tasks: ["Chat completion"],
      use_cases: ["Code generation", "Document analysis"],
    });
    expect(Object.keys(catalogModel?.availability ?? {})).toEqual([
      "aws",
      "azure",
      "gcp",
    ]);
    expect(catalogModel?.price.azure).toEqual({
      DBU: {
        unit: "per_million_tokens",
        rates: { input: 2, output: 3 },
      },
      USD: {
        unit: "per_million_tokens",
        rates: { input: 0.4, output: 0.6 },
      },
    });
    expect(catalogModel?.average_price.USD?.rates.input).toBe(0.42);
    expect("pricing" in (catalogModel ?? {})).toBe(false);
    expect("cloudProviders" in (catalogModel ?? {})).toBe(false);
    expect(catalogModel?.retirement?.schedules).toEqual([
      { offering: "Pay-per-token", dates: ["2026-07-16"] },
      { offering: "Provisioned throughput", dates: ["2026-10-02"] },
    ]);
    expect(catalogModel?.notices).toEqual([
      {
        kind: "important",
        text: "Customers must follow Anthropic's usage policy. See also the Databricks agreement.",
      },
      {
        kind: "important",
        text: "For GPT Test, prompts are retained for 30 days.",
      },
    ]);
    expect("sources" in (catalogModel ?? {})).toBe(false);
    expect(JSON.stringify(catalogModel)).not.toContain('"url"');
    expect(JSON.stringify(catalogModel)).not.toContain('"links"');
    expect(JSON.stringify(catalogModel)).not.toContain('"interfaces"');
    expect(JSON.stringify(catalogModel)).not.toContain('"source"');
    expect(JSON.stringify(catalogModel)).not.toContain('"dataset"');
    expect(JSON.stringify(catalogModel)).not.toContain('"configuration"');
    expect(JSON.stringify(catalogModel)).not.toContain('"sourceModelName"');
    expect(JSON.stringify(catalogModel)).not.toContain("livebench");
    expect(catalogModel?.status).toBe("deprecated");
    expect(catalogModel?.rankings[0]?.variant).toEqual({
      reasoning: true,
      reasoning_effort: "high",
      harness: "codex",
    });
    expect(catalogModel?.benchmarks).toContainEqual({
      name: "overall",
      rank: 2,
      published_at: "2026-10-30",
      score: 85,
      task_count: 2,
      variant: {
        reasoning: true,
        reasoning_effort: "high",
        reasoning_mode: "thinking",
        context: 64_000,
      },
    });
    expect(catalog.models["unmatched-model"]).toBeUndefined();
    expect("parameters" in (catalogModel ?? {})).toBe(false);
    expect("ownership" in (catalogModel ?? {})).toBe(false);
    expect("lifecycle" in (catalogModel ?? {})).toBe(false);
    expect("databricks" in (catalogModel ?? {})).toBe(false);
  });
});

describe("source schemas", () => {
  test("preserve fields not yet modeled by the catalog", () => {
    const modelsDev = modelsDevSchema.parse({
      provider: {
        id: "provider",
        env: ["PROVIDER_API_KEY"],
        npm: "@example/provider",
        name: "Provider",
        doc: "https://example.com/docs",
        futureProviderField: true,
        models: {
          model: {
            id: "model",
            name: "Model",
            description: "Model description",
            attachment: true,
            reasoning: true,
            tool_call: true,
            release_date: "2026-10-01",
            last_updated: "2026-10-30",
            modalities: { input: ["text"], output: ["text"] },
            open_weights: false,
            limit: { context: 200_000, output: 32_000 },
            futureModelField: "kept",
          },
        },
      },
    });
    const modelParams = modelParamsSchema.parse({
      $schema: "https://example.com/schema.json",
      generatedAt: "2026-10-30T00:00:00.000Z",
      count: 1,
      futureCatalogField: true,
      models: [
        {
          provider: "provider",
          authType: "api_key",
          apiSurface: "openai-chat-completions",
          model: "model",
          futureModelField: "kept",
          params: [
            {
              path: "temperature",
              label: "Temperature",
              description: "Controls randomness.",
              group: "sampling",
              type: "number",
              range: { min: 0, max: 2, step: 0.1 },
              futureParamField: 1,
            },
          ],
        },
      ],
    });
    const lmArena = lmArenaSchema.parse({
      dataset: "lmarena-ai/leaderboard-dataset",
      split: "latest",
      metadata: [],
      configurations: {
        text: {
          rows: [
            {
              model_name: "GPT-5.6 Luna (xHigh, Codex Harness)",
              organization: "openai",
              license: "Proprietary",
              rating: 1508.0727680847874,
              rating_lower: 1500.265447547061,
              rating_upper: 1515.8800886225138,
              variance: 15.867475566948645,
              vote_count: "7691",
              rank: "60",
              category: "webdev-react",
              leaderboard_publish_date: "2026-10-28",
              futureRowField: "kept",
            },
          ],
        },
      },
    });
    const liveBench = liveBenchSchema.parse({
      dataset: "LiveBench/livebench.github.io",
      release: "2026-06-25",
      metadata: [],
      categories: { Reasoning: ["logic"] },
      rows: [
        {
          model: "future-model",
          scores: { logic: 91 },
          futureRowField: "kept",
        },
      ],
      futureCatalogField: true,
    });
    const databricksModel = DatabricksSupportedModelSchema.parse({
      sectionId: "future-model",
      name: "Future Models Inc. Example 1",
      publisher: "Future Models Inc.",
      supportedInputs: ["text"],
      status: "experimental",
      description: "A future model.",
      paragraphs: [],
      notices: [],
      links: [],
      taskTypes: [],
      useCases: [],
      reasoning: {
        type: "adaptive",
        details: "Uses a newly documented reasoning mode.",
        parameters: "Accepted values are ultra.",
        levels: ["ultra"],
        futureReasoningField: true,
      },
      webSearch: false,
      deprecated: false,
      retirements: [],
      pricing: [],
      futureModelField: "kept",
    });

    expect(modelsDev.provider?.futureProviderField).toBe(true);
    expect(modelsDev.provider?.models.model?.futureModelField).toBe("kept");
    expect(modelsDev.provider?.models.model?.limit.context).toBe(200_000);
    expect(modelsDev.provider?.models.model?.release_date.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(modelParams.futureCatalogField).toBe(true);
    expect(modelParams.models[0]?.futureModelField).toBe("kept");
    expect(modelParams.models[0]?.params[0]?.range?.max).toBe(2);
    expect(modelParams.generatedAt.toISOString()).toBe(
      "2026-10-30T00:00:00.000Z",
    );
    expect(lmArena.configurations.text?.rows[0]?.futureRowField).toBe("kept");
    expect(lmArena.configurations.text?.rows[0]?.rank).toBe(60);
    expect(
      lmArena.configurations.text?.rows[0]?.leaderboard_publish_date.toISOString(),
    ).toBe("2026-10-28T00:00:00.000Z");
    expect(liveBench.futureCatalogField).toBe(true);
    expect(liveBench.rows[0]?.futureRowField).toBe("kept");
    expect(databricksModel.futureModelField).toBe("kept");
    expect(databricksModel.reasoning?.levels).toEqual(["ultra"]);
    expect(databricksModel.reasoning?.futureReasoningField).toBe(true);
  });
});

describe("flexibleDateSchema", () => {
  test("parses partial and natural-language dates in UTC", () => {
    expect(flexibleDateSchema.parse("2023-05").toISOString()).toBe(
      "2023-05-01T00:00:00.000Z",
    );
    expect(parseFlexibleDate("October 28, 2026")?.toISOString()).toBe(
      "2026-10-28T00:00:00.000Z",
    );
    const cached = new Date("2026-10-30T00:00:00.000Z");
    expect(flexibleDateSchema.parse(cached)).toBe(cached);
  });
});

describe("stringifyJson", () => {
  test("serializes nested BigInts as strings without losing precision", () => {
    const value = {
      count: 30_801n,
      nested: [9_007_199_254_740_993n],
    };

    expect(stringifyJson(value)).toBe(
      '{"count":"30801","nested":["9007199254740993"]}',
    );
  });
});
