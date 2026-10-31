import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import {
  type Fetcher,
  SyncClient,
  type SyncClientOptions,
} from "./client.ts";

export const LIVEBENCH_REPOSITORY = "LiveBench/livebench.github.io";
export const LIVEBENCH_BRANCH = "main";
export const LIVEBENCH_DATASET = LIVEBENCH_REPOSITORY;

const LIVEBENCH_CONTENTS_URL =
  `https://api.github.com/repos/${LIVEBENCH_REPOSITORY}/contents/public?ref=${LIVEBENCH_BRANCH}`;
const LIVEBENCH_RAW_BASE_URL =
  `https://raw.githubusercontent.com/${LIVEBENCH_REPOSITORY}/${LIVEBENCH_BRANCH}/public`;

const liveBenchRepositoryFileSchema = z.looseObject({
  name: z.string(),
  path: z.string(),
  sha: z.string(),
  size: z.number().int().nonnegative(),
  type: z.string(),
  download_url: z.string().nullable(),
});

export const liveBenchRowSchema = z.looseObject({
  model: z.string(),
  scores: z.record(z.string(), z.number().nullable()),
});

export const liveBenchSchema = z.looseObject({
  dataset: z.literal(LIVEBENCH_DATASET),
  release: z.iso.date(),
  metadata: z.array(liveBenchRepositoryFileSchema),
  categories: z.record(z.string(), z.array(z.string())),
  rows: z.array(liveBenchRowSchema),
});

export type LiveBenchRow = z.infer<typeof liveBenchRowSchema>;
export type LiveBenchCatalogData = z.infer<typeof liveBenchSchema>;

export class LiveBenchSyncClient extends SyncClient<LiveBenchCatalogData> {
  protected readonly schema = liveBenchSchema;

  public constructor(
    private readonly fetcher: Fetcher = fetch,
    options: SyncClientOptions = {},
  ) {
    super(options);
  }

  public async read(): Promise<LiveBenchCatalogData> {
    const metadata = await this.readJson(LIVEBENCH_CONTENTS_URL);
    const files = z.array(liveBenchRepositoryFileSchema).parse(metadata);
    const release = latestRelease(files);
    const [categories, table] = await Promise.all([
      this.readJson(`${LIVEBENCH_RAW_BASE_URL}/${release.categoriesFile}`),
      this.readText(`${LIVEBENCH_RAW_BASE_URL}/${release.tableFile}`, "text/csv"),
    ]);

    return this.parse({
      dataset: LIVEBENCH_DATASET,
      release: release.date,
      metadata: files,
      categories,
      rows: parseRows(table),
    });
  }

  private async readJson(url: string): Promise<unknown> {
    return this.cacheGetOrSet(url, async () => {
      const response = await this.fetcher(url, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "dbx-model-catalog",
        },
      });
      if (!response.ok) {
        throw new Error(
          `GET ${url} failed with ${response.status} ${response.statusText}`,
        );
      }
      return response.json() as Promise<unknown>;
    });
  }

  private async readText(url: string, accept: string): Promise<string> {
    return this.cacheGetOrSet(url, async () => {
      const response = await this.fetcher(url, { headers: { accept } });
      if (!response.ok) {
        throw new Error(
          `GET ${url} failed with ${response.status} ${response.statusText}`,
        );
      }
      return response.text();
    });
  }
}

function latestRelease(
  files: readonly z.infer<typeof liveBenchRepositoryFileSchema>[],
): {
  readonly date: string;
  readonly categoriesFile: string;
  readonly tableFile: string;
} {
  const tables = new Map<string, string>();
  const categories = new Map<string, string>();
  for (const file of files) {
    const table = /^table_(\d{4}[-_]\d{2}[-_]\d{2})\.csv$/.exec(file.name);
    if (table?.[1]) tables.set(normalizeReleaseDate(table[1]), file.name);
    const category = /^categories_(\d{4}[-_]\d{2}[-_]\d{2})\.json$/.exec(
      file.name,
    );
    if (category?.[1]) {
      categories.set(normalizeReleaseDate(category[1]), file.name);
    }
  }
  const date = [...categories.keys()]
    .filter((release) => tables.has(release))
    .sort()
    .at(-1);
  const release = date
    ? {
        date,
        categoriesFile: categories.get(date)!,
        tableFile: tables.get(date)!,
      }
    : undefined;
  if (!release) {
    throw new Error(
      "LiveBench repository contained no complete leaderboard release",
    );
  }
  return release;
}

function normalizeReleaseDate(value: string): string {
  return value.replaceAll("_", "-");
}

function parseRows(value: string): LiveBenchRow[] {
  const records = parseCsv(value, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return records.map((record) => {
    const model = record.model?.trim();
    if (!model) throw new Error("LiveBench leaderboard row is missing its model");
    const scores: Record<string, number | null> = {};
    for (const [task, rawValue] of Object.entries(record)) {
      if (task === "model") continue;
      const text = rawValue.trim();
      if (!text) {
        scores[task] = null;
        continue;
      }
      const score = Number(text);
      if (!Number.isFinite(score)) {
        throw new Error(
          `Invalid LiveBench score for ${model}/${task}: ${text}`,
        );
      }
      scores[task] = score;
    }
    return liveBenchRowSchema.parse({ model, scores });
  });
}
