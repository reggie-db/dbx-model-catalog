import type {
  CatalogFilters,
  CatalogModelRecord,
  CatalogSearchIndexPayload,
} from "./_generated/schemas.js";
import { searchCatalogRecords } from "./search.js";

export function filterCatalogRecords(
  records: readonly CatalogModelRecord[],
  searchIndex: CatalogSearchIndexPayload,
  filters: CatalogFilters = {},
): CatalogModelRecord[] {
  const limit = filters.limit === undefined ? 50 : filters.limit;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0 || limit > 1_000)) {
    throw new RangeError("limit must be an integer between 0 and 1000, or null");
  }
  const filtered = records.filter(record =>
    includes(filters.status, record.status)
    && includes(filters.type, record.type)
    && includes(filters.publisher, record.publisher)
    && (filters.task ?? []).every(task => record.tasks.includes(task))
    && (filters.capability ?? []).every(capability => hasCapability(record, capability)),
  );
  const query = filters.query?.trim();
  if (query) return searchCatalogRecords(searchIndex, filtered, query, limit);
  filtered.sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));
  return limit === null ? filtered : filtered.slice(0, limit);
}

function includes<T>(expected: readonly T[] | undefined, actual: T | null | undefined): boolean {
  return !expected?.length || (actual !== null && actual !== undefined && expected.includes(actual));
}

function hasCapability(
  record: CatalogModelRecord,
  capability: NonNullable<CatalogFilters["capability"]>[number],
): boolean {
  const field = capability.replaceAll("-", "_") as keyof CatalogModelRecord["capabilities"];
  const value = record.capabilities[field];
  return capability === "reasoning" ? value !== null && value !== undefined : value === true;
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}
