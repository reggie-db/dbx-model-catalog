import { blobFromBase64String, blobToBase64String } from "@metapages/hash-query";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { z } from "zod";
import { catalogColumnIdSchema } from "./columns.js";

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

export function decodeCatalogViewState(
  encoded: string | undefined,
  defaults: CatalogViewDefaults = {},
): CatalogViewState {
  let raw: Record<string, unknown> = {};
  if (encoded) {
    try {
      const result = decodedViewSchema.safeParse(blobFromBase64String(encoded));
      if (result.success) raw = result.data;
    } catch {
      // Invalid or outdated links fall back to the usable portions of the current view.
    }
  }

  const search = parseOptional(z.string(), raw.search) ?? "";
  const requestedSorting = uniqueById(parseArray(sortingEntrySchema, raw.sorting));
  const requestedFilters = uniqueById(parseArray(columnFilterSchema, raw.columnFilters))
    .flatMap(({ id, value }) => {
      const filterValue = sanitizeFilterValue(value);
      return filterValue === undefined ? [] : [{ id, value: filterValue }];
    });
  const hashModel = parseOptional(z.string().min(1), raw.model);

  return {
    version: 1,
    search,
    sorting: requestedSorting.length
      ? requestedSorting.map(({ id, desc }) => ({ id, desc: desc === true }))
      : [{ id: search.trim() ? "relevance" : "model", desc: false }],
    columnFilters: requestedFilters,
    ...(hashModel || defaults.legacyModel ? { model: hashModel ?? defaults.legacyModel } : {}),
    modelView: parseOptional(modelViewSchema, raw.modelView) ?? "details",
    descriptionExpanded: parseOptional(z.boolean(), raw.descriptionExpanded) ?? false,
  };
}

export function encodeCatalogViewState(state: CatalogViewState): string {
  return blobToBase64String(state);
}
