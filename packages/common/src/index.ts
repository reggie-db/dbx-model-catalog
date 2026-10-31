export * from "./model.ts";

export type ModelSource =
  | "models.dev"
  | "modelparams.dev"
  | "lm-arena"
  | "livebench"
  | "databricks";

export interface SyncResult<TSource extends ModelSource, TData> {
  readonly source: TSource;
  readonly fetchedAt: string;
  readonly data: TData;
}
