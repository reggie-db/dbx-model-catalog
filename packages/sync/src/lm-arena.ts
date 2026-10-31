import { downloadFile, listFiles, type ListFileEntry } from "@huggingface/hub";
import { parquetReadObjects } from "hyparquet";
import { z } from "zod";
import { SyncClient } from "./client.ts";
import { flexibleDateSchema } from "./date.ts";

export const LM_ARENA_DATASET = "lmarena-ai/leaderboard-dataset";
export const LM_ARENA_SPLIT = "latest";

const LM_ARENA_REPO = { type: "dataset", name: LM_ARENA_DATASET } as const;

const parquetIntegerSchema = z.union([
  z.number().int(),
  z.bigint(),
  z.string(),
]).pipe(z.coerce.number()).pipe(z.int().nonnegative());

const lmArenaRowShape = {
  model_name: z.string(),
  organization: z.string(),
  license: z.string(),
  rank: parquetIntegerSchema,
  category: z.string(),
  leaderboard_publish_date: flexibleDateSchema,
};

export const lmArenaRatingRowSchema = z.looseObject({
  ...lmArenaRowShape,
  rating: z.number(),
  rating_lower: z.number(),
  rating_upper: z.number(),
  variance: z.number(),
  vote_count: parquetIntegerSchema,
});

export const lmArenaScoreRowSchema = z.looseObject({
  ...lmArenaRowShape,
  score: z.number(),
  score_ci_lower: z.number(),
  score_ci_upper: z.number(),
  observation_count: parquetIntegerSchema,
  session_count: parquetIntegerSchema.nullable(),
});

export const lmArenaRowSchema = z.union([
  lmArenaRatingRowSchema,
  lmArenaScoreRowSchema,
]);

export const lmArenaMetadataEntrySchema = z.looseObject({
  type: z.string(),
  oid: z.string(),
  size: z.number(),
  path: z.string(),
  lfs: z
    .looseObject({
      oid: z.string(),
      size: z.number(),
      pointerSize: z.number(),
    })
    .optional(),
  xetHash: z.string().optional(),
});

const lmArenaConfigurationSchema = z.looseObject({
  rows: z.array(lmArenaRowSchema),
});

export const lmArenaSchema = z.looseObject({
  dataset: z.literal(LM_ARENA_DATASET),
  split: z.literal(LM_ARENA_SPLIT),
  metadata: z.array(lmArenaMetadataEntrySchema),
  configurations: z.record(z.string(), lmArenaConfigurationSchema),
});

export type LMArenaRow = z.infer<typeof lmArenaRowSchema>;
export type LMArenaCatalogData = z.infer<typeof lmArenaSchema>;

export class LMArenaSyncClient extends SyncClient<LMArenaCatalogData> {
  protected readonly schema = lmArenaSchema;

  public async read(): Promise<LMArenaCatalogData> {
    const value = await this.cacheGetOrSet(
      `https://huggingface.co/datasets/${LM_ARENA_DATASET}/tree/main`,
      () => this.readDataset(),
    );
    return this.parse(value);
  }

  private async readDataset(): Promise<LMArenaCatalogData> {
    const metadata = await this.listDatasetFiles();
    const files = this.latestParquetFiles(metadata);
    const entries = await Promise.all(
      [...files].map(async ([configuration, shards]) => {
        const rows = (
          await Promise.all(
            shards.map(async (shard) => {
              const blob = await downloadFile({
                repo: LM_ARENA_REPO,
                path: shard.path,
              });
              if (!blob) {
                throw new Error(`Hugging Face file not found: ${shard.path}`);
              }
              return parquetReadObjects({ file: await blob.arrayBuffer() });
            }),
          )
        ).flat();

        return [configuration, { rows }] as const;
      }),
    );

    return this.parse({
      dataset: LM_ARENA_DATASET,
      split: LM_ARENA_SPLIT,
      metadata,
      configurations: Object.fromEntries(entries),
    });
  }

  private async listDatasetFiles(): Promise<ListFileEntry[]> {
    const files: ListFileEntry[] = [];
    for await (const file of listFiles({ repo: LM_ARENA_REPO, recursive: true })) {
      files.push(file);
    }
    return files;
  }

  private latestParquetFiles(
    value: readonly ListFileEntry[],
  ): Map<string, ListFileEntry[]> {
    const files = new Map<string, ListFileEntry[]>();
    for (const item of value) {
      if (item.type !== "file") continue;
      const match = /^([^/]+)\/latest-[^/]+\.parquet$/.exec(item.path);
      const configuration = match?.[1];
      if (!configuration) continue;
      const shards = files.get(configuration) ?? [];
      shards.push(item);
      files.set(configuration, shards);
    }

    if (files.size === 0) {
      throw new Error("Hugging Face LMArena dataset contained no latest parquet files");
    }

    return files;
  }
}
