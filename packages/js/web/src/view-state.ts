import { blobFromBase64String } from "@metapages/hash-query";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { z } from "zod";
import { catalogColumnIdSchema } from "./columns.js";

const filterParamPrefix = "filter.";

const sortingEntrySchema = z.object({
  id: catalogColumnIdSchema,
  desc: z.boolean().optional(),
});
const columnFilterSchema = z.object({
  id: catalogColumnIdSchema,
  value: z.unknown(),
});
const decodedViewSchema = z.looseObject({});
const modelViewSchema = z.enum(["details", "json"]);

export interface CatalogViewState {
  readonly version: 1;
  readonly search: string;
  readonly sorting: SortingState;
  readonly columnFilters: ColumnFiltersState;
  readonly model?: string;
  readonly modelView: "details" | "json";
  readonly descriptionExpanded: boolean;
}

export interface CatalogViewDefaults {
  readonly legacyModel?: string;
}

export type CatalogViewHashParams = Readonly<Record<string, string | undefined>>;

function parseArray<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    const result = schema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

function parseOptional<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

function uniqueById<T extends { readonly id: string }>(values: readonly T[]): T[] {
  const seen = new Set<string>();
  return values.filter(value => {
    if (seen.has(value.id)) return false;
    seen.add(value.id);
    return true;
  });
}

function sanitizeFilterValue(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function decodeParam(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function decodeLegacyView(encoded: string | undefined): Record<string, unknown> {
  if (!encoded) return {};
  try {
    const result = decodedViewSchema.safeParse(blobFromBase64String(encoded));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

function decodeSorting(value: string | undefined): SortingState | undefined {
  const decoded = decodeParam(value);
  if (decoded === undefined) return undefined;
  return uniqueById(decoded.split(",").flatMap(entry => {
    const [id, direction, ...rest] = entry.split(".");
    if (rest.length || (direction !== "asc" && direction !== "desc")) return [];
    const result = sortingEntrySchema.safeParse({ id, desc: direction === "desc" });
    return result.success ? [result.data] : [];
  })).map(({ id, desc }) => ({ id, desc: desc === true }));
}

function decodeFilters(params: CatalogViewHashParams): ColumnFiltersState | undefined {
  const entries = Object.entries(params).filter(([key]) => key.startsWith(filterParamPrefix));
  if (!entries.length) return undefined;
  return uniqueById(entries.flatMap(([key, encodedValue]) => {
    const id = key.slice(filterParamPrefix.length);
    const decodedValue = decodeParam(encodedValue);
    if (decodedValue === undefined) return [];
    try {
      const result = columnFilterSchema.safeParse({ id, value: JSON.parse(decodedValue) });
      if (!result.success) return [];
      const value = sanitizeFilterValue(result.data.value);
      return value === undefined ? [] : [{ id: result.data.id, value }];
    } catch {
      return [];
    }
  }));
}

export function decodeCatalogViewState(
  params: CatalogViewHashParams,
  defaults: CatalogViewDefaults = {},
): CatalogViewState {
  const raw = decodeLegacyView(params.view);

  const search = decodeParam(params.search) ?? parseOptional(z.string(), raw.search) ?? "";
  const requestedSorting = decodeSorting(params.sort)
    ?? uniqueById(parseArray(sortingEntrySchema, raw.sorting));
  const requestedFilters = decodeFilters(params)
    ?? uniqueById(parseArray(columnFilterSchema, raw.columnFilters))
    .flatMap(({ id, value }) => {
      const filterValue = sanitizeFilterValue(value);
      return filterValue === undefined ? [] : [{ id, value: filterValue }];
    });
  const hashModel = parseOptional(z.string().min(1), decodeParam(params.model))
    ?? parseOptional(z.string().min(1), raw.model);

  return {
    version: 1,
    search,
    sorting: requestedSorting.length
      ? requestedSorting.map(({ id, desc }) => ({ id, desc: desc === true }))
      : [{ id: search.trim() ? "relevance" : "model", desc: false }],
    columnFilters: requestedFilters,
    ...(hashModel || defaults.legacyModel ? { model: hashModel ?? defaults.legacyModel } : {}),
    modelView: parseOptional(modelViewSchema, decodeParam(params.mode))
      ?? parseOptional(modelViewSchema, raw.modelView)
      ?? "details",
    descriptionExpanded: params.description === "expanded"
      || (params.description === undefined && parseOptional(z.boolean(), raw.descriptionExpanded) === true),
  };
}

export function encodeCatalogViewState(
  state: CatalogViewState,
  existingParams: CatalogViewHashParams = {},
): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {
    view: undefined,
    v: String(state.version),
    search: state.search ? encodeURIComponent(state.search) : undefined,
    sort: encodeURIComponent(state.sorting
      .map(({ id, desc }) => `${id}.${desc ? "desc" : "asc"}`)
      .join(",")),
    model: state.model ? encodeURIComponent(state.model) : undefined,
    mode: state.modelView === "json" ? state.modelView : undefined,
    description: state.descriptionExpanded ? "expanded" : undefined,
  };

  for (const key of Object.keys(existingParams)) {
    if (key.startsWith(filterParamPrefix)) params[key] = undefined;
  }
  for (const { id, value } of state.columnFilters) {
    params[`${filterParamPrefix}${id}`] = encodeURIComponent(JSON.stringify(value));
  }
  return params;
}
