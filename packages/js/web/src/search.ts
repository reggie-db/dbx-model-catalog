import type {
  CatalogModelRecord,
  CatalogSearchIndexDocument,
  CatalogSearchIndexPayload,
} from "@dbx-tools/dbx-model-catalog/browser";
import Fuse from "fuse.js";

function normalizeSearch(value: string) {
  return (value.normalize("NFKC").toLocaleLowerCase().match(/[a-z]+|\d+/g) ?? []).join(" ");
}

function requestedVersion(value: string) {
  const match = /(?:^|[^a-z0-9])(\d+)(?:[.\-_](\d+))?(?:[.\-_](\d+))?(?![a-z0-9])/i.exec(value);
  return match
    ? match.slice(1).filter((part): part is string => Boolean(part)).map(Number)
    : [];
}

function versionDistance(candidate: number[], requested: number[]) {
  if (!candidate.length) return [1, 1, 1_000, 1_000, 1_000];
  const left = [...candidate, 0, 0, 0].slice(0, 3);
  const right = [...requested, 0, 0, 0].slice(0, 3);
  return [
    0,
    left[0] === right[0] ? 0 : 1,
    Math.abs(left[0]! - right[0]!),
    Math.abs(left[1]! - right[1]!),
    Math.abs(left[2]! - right[2]!),
  ];
}

function compareNumberArrays(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function strictRelevance(document: CatalogSearchIndexDocument, query: string, terms: string[]) {
  if (document.exact_identities.includes(query)) return 100;
  if (document.identities.some(identity => identity.includes(query))) return 96;
  if (document.identities.some(identity => terms.every(term => identity.split(" ").includes(term)))) {
    return 94;
  }
  return 88;
}

export function searchStaticCatalog<T extends CatalogModelRecord>(
  index: CatalogSearchIndexPayload,
  models: T[],
  query: string,
): T[] {
  const normalized = normalizeSearch(query);
  const terms = normalized.split(" ").filter(Boolean);
  if (!terms.length) return [];
  const modelById = new Map(models.map(model => [model.id, model]));
  const strict = index.documents.filter(document =>
    terms.every(term => document.tokens.some(token => token.startsWith(term))),
  );
  const fuzzy = strict.length
    ? []
    : new Fuse(index.documents, {
        keys: [
          { name: "identities", weight: 1 },
          { name: "keywords", weight: 0.84 },
          { name: "description", weight: 0.55 },
        ],
        threshold: 0.42,
        ignoreLocation: true,
        includeScore: true,
      }).search(normalized);
  const candidates = strict.length
    ? strict.map(document => ({
        document,
        relevance: strictRelevance(document, normalized, terms),
      }))
    : fuzzy.map(result => ({
        document: result.item,
        relevance: (1 - (result.score ?? 1)) * 100,
      }));
  const version = requestedVersion(query);
  return candidates
    .map(candidate => ({
      ...candidate,
      exact: candidate.document.exact_identities.includes(normalized),
      score:
        candidate.relevance * index.weights.relevance
        + candidate.document.quality_score * (1 - index.weights.relevance),
    }))
    .sort((left, right) => {
      if (left.exact !== right.exact) return left.exact ? -1 : 1;
      if (version.length) {
        const distance = compareNumberArrays(
          versionDistance(left.document.version, version),
          versionDistance(right.document.version, version),
        );
        if (distance) return distance;
      }
      return right.score - left.score
        || right.relevance - left.relevance
        || right.document.quality_score - left.document.quality_score
        || left.document.id.localeCompare(right.document.id);
    })
    .flatMap(candidate => {
      const model = modelById.get(candidate.document.id);
      return model ? [model] : [];
    });
}
