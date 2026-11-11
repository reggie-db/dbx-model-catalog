import type {
  CatalogFilters,
  CatalogModelRecord,
  CatalogSearchIndexPayload,
  ModelCatalog,
} from "./_generated/schemas.js";
import { modelIdentities, normalizeModelIdentity, type ModelIdentity } from "./identity.js";
import { filterCatalogRecords } from "./filter.js";
import { searchCatalogMatches, type CatalogSearchMatch } from "./search.js";

export interface CatalogIdentityMatch {
  readonly identity: ModelIdentity;
  readonly record: CatalogModelRecord;
}

export interface EnrichedLiveModel<T> {
  readonly live: T;
  readonly published?: CatalogIdentityMatch;
}

/** Immutable identity and search index over one catalog snapshot. */
export class ModelCatalogIndex {
  readonly records: readonly CatalogModelRecord[];
  private readonly exact = new Map<string, CatalogIdentityMatch>();
  private readonly normalized = new Map<string, CatalogIdentityMatch | null>();

  constructor(
    readonly catalog: ModelCatalog,
    readonly searchIndex: CatalogSearchIndexPayload,
  ) {
    this.records = Object.entries(catalog.models).map(([id, model]) => ({ ...model, id }));
    for (const record of this.records) {
      for (const identity of modelIdentities(record)) {
        this.exact.set(identity.value.toLowerCase(), { identity, record });
        const key = normalizeModelIdentity(identity.value);
        const current = this.normalized.get(key);
        this.normalized.set(key, current === undefined ? { identity, record } : null);
      }
    }
  }

  get(id: string): CatalogModelRecord | undefined {
    return this.catalog.models[id] ? { ...this.catalog.models[id]!, id } : undefined;
  }

  resolve(value: string): CatalogIdentityMatch | undefined {
    const exact = this.exact.get(value.trim().toLowerCase());
    if (exact) return exact;
    return this.normalized.get(normalizeModelIdentity(value)) ?? undefined;
  }

  matchAny(values: readonly string[]): CatalogIdentityMatch | undefined {
    for (const value of values) {
      const match = this.resolve(value);
      if (match) return match;
    }
    return undefined;
  }

  list(filters: CatalogFilters = {}): CatalogModelRecord[] {
    return filterCatalogRecords(this.records, this.searchIndex, filters);
  }

  search(query: string, limit: number | null = 50): CatalogSearchMatch[] {
    return searchCatalogMatches(this.searchIndex, this.records, query, limit);
  }
}

export function createModelCatalogIndex(
  catalog: ModelCatalog,
  searchIndex: CatalogSearchIndexPayload,
): ModelCatalogIndex {
  return new ModelCatalogIndex(catalog, searchIndex);
}

/** Join live models to published facts without dropping undocumented live entries. */
export function enrichLiveModels<T>(
  index: ModelCatalogIndex,
  models: readonly T[],
  identities: (model: T) => readonly string[],
): EnrichedLiveModel<T>[] {
  return models.map(live => {
    const published = index.matchAny(identities(live));
    return published ? { live, published } : { live };
  });
}
