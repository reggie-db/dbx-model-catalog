import type {
  CatalogModelRecord,
  CatalogSearchIndexDocument,
  CatalogSearchIndexPayload,
} from "./_generated/schemas.js";

// The fuzzy string scoring formulas follow RapidFuzz's MIT-licensed behavior.
// Copyright (C) 2022 Max Bachmann and RapidFuzz contributors.

interface SearchField {
  readonly identity: boolean;
  readonly name: string;
  readonly value: string;
  readonly weight: number;
}

interface FieldScore {
  readonly field: SearchField;
  readonly kind: "exact" | "fuzzy" | "token";
  readonly score: number;
}

export interface CatalogSearchMatch {
  readonly exact: boolean;
  readonly kind: "exact" | "fuzzy" | "token";
  readonly record: CatalogModelRecord;
  readonly relevance: number;
  readonly score: number;
}

interface ScoredRecord extends CatalogSearchMatch {
  readonly identityExact: boolean;
  readonly record: CatalogModelRecord;
  readonly relevance: number;
  readonly releaseDate: string | null;
  readonly score: number;
  readonly version: number[];
}

const neutralScore = 50;
const statusPriority = new Map([
  "active",
  "preview",
  "beta",
  "alpha",
  "legacy",
  "deprecated",
  "retired",
].map((status, index) => [status, index]));
const tokenPattern = /[a-z]+|\d+/g;
const versionPattern = /(?:^|[^a-z0-9])(\d+)(?:[.\-_](\d+))?(?:[.\-_](\d+))?(?![a-z0-9])/i;

export function searchCatalogRecords<T extends CatalogModelRecord>(
  index: CatalogSearchIndexPayload,
  models: readonly T[],
  query: string,
  limit: number | null = 50,
): T[] {
  return searchCatalogMatches(index, models, query, limit).map(match => match.record as T);
}

export function searchCatalogMatches<T extends CatalogModelRecord>(
  index: CatalogSearchIndexPayload,
  models: readonly T[],
  query: string,
  limit: number | null = 50,
): CatalogSearchMatch[] {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery || limit === 0) return [];
  const queryTokens = tokens(normalizedQuery).filter(token => !/^\d+$/.test(token));
  const requestedVersion = version(query);
  const documentById = new Map(index.documents.map(document => [document.id, document]));
  const referenceDate = index.updated_at.slice(0, 10);
  const scored = models.flatMap(model => {
    const document = documentById.get(model.id);
    if (!document) return [];
    const candidate = scoreRecord(
      model,
      document,
      index,
      normalizedQuery,
      queryTokens,
      requestedVersion,
      referenceDate,
    );
    return candidate ? [candidate] : [];
  });
  scored.sort((left, right) => compareScored(left, right, requestedVersion));
  const results = scored.map(({ identityExact: _identityExact, releaseDate: _releaseDate, version: _version, ...candidate }) => candidate);
  return limit === null ? results : results.slice(0, limit);
}

function scoreRecord(
  record: CatalogModelRecord,
  document: CatalogSearchIndexDocument,
  index: CatalogSearchIndexPayload,
  query: string,
  queryTokens: string[],
  requestedVersion: number[],
  referenceDate: string,
): ScoredRecord | undefined {
  const fields = searchFields(record);
  const fieldScores = fields.map(field => scoreField(field, query, new Set(queryTokens)));
  const tokenScores = queryTokenScores(queryTokens, document.tokens);
  if (!passesTokenGate(queryTokens, tokenScores, document.identities, requestedVersion.length > 0)) {
    return undefined;
  }
  const relevance = Math.max(
    ...fieldScores.map(item => item.score),
    tokenScores.length ? mean(tokenScores) * 0.94 : 0,
  );
  if (relevance < 58) return undefined;

  const leading = fieldScores.filter(item => item.score >= relevance - 8);
  const identityMatch = (
    queryTokens.length > 0
    && queryTokens.every(token => document.identities.some(identity => tokens(identity).includes(token)))
  ) || leading.some(item => item.field.identity);
  const identityExact = leading.some(item =>
    item.kind === "exact" && ["id", "name", "alias"].includes(item.field.name),
  );
  const quality = {
    leaderboard: leaderboardScore(record, queryTokens, referenceDate),
    benchmark: benchmarkScore(record, queryTokens, referenceDate),
    version: requestedVersion.length
      ? requestedVersionScore(document.version, requestedVersion)
      : identityMatch ? document.scores.version : neutralScore,
    freshness: document.scores.freshness,
    lifecycle: document.scores.lifecycle,
  };
  const combined = round3(
    relevance * index.weights.relevance
    + quality.leaderboard * index.weights.leaderboard
    + quality.benchmark * index.weights.benchmark
    + quality.version * index.weights.version
    + quality.freshness * index.weights.freshness
    + quality.lifecycle * index.weights.lifecycle,
  );
  return {
    exact: identityExact,
    identityExact,
    kind: identityExact ? "exact" : leading.some(item => item.kind === "token") ? "token" : "fuzzy",
    record,
    relevance: round3(relevance),
    releaseDate: record.release_date ?? null,
    score: combined,
    version: document.version,
  };
}

function scoreField(field: SearchField, query: string, requestedTokens: Set<string>): FieldScore {
  const weighted = Math.max(weightedRatio(query, field.value), tokenSetRatio(query, field.value))
    * field.weight;
  if (query === field.value) return { field, kind: "exact", score: 100 };
  if (field.value.includes(query)) {
    return { field, kind: "token", score: Math.max(weighted, 96 * field.weight) };
  }
  const fieldTokens = new Set(tokens(field.value));
  if (requestedTokens.size > 0 && [...requestedTokens].every(token => fieldTokens.has(token))) {
    return { field, kind: "token", score: Math.max(weighted, 94 * field.weight) };
  }
  return { field, kind: "fuzzy", score: weighted };
}

function passesTokenGate(
  queryTokens: string[],
  tokenScores: number[],
  identities: string[],
  requireIdentity: boolean,
): boolean {
  if (queryTokens.some((token, index) => (tokenScores[index] ?? 0) < (token.length <= 3 ? 80 : 65))) {
    return false;
  }
  if (!requireIdentity || queryTokens.length === 0) return true;
  const identityTokens = new Set(identities.flatMap(identity => tokens(identity)));
  return Math.min(...queryTokenScores(queryTokens, [...identityTokens])) >= 75;
}

function queryTokenScores(queryTokens: string[], candidateTokens: readonly string[]): number[] {
  return queryTokens.map(token => Math.max(0, ...candidateTokens.map(candidate => ratio(token, candidate))));
}

function compareScored(left: ScoredRecord, right: ScoredRecord, requestedVersion: number[]): number {
  if (left.identityExact !== right.identityExact) return left.identityExact ? -1 : 1;
  if (requestedVersion.length) {
    const distance = compareNumbers(
      versionDistance(left.version, requestedVersion),
      versionDistance(right.version, requestedVersion),
    );
    if (distance) return distance;
  }
  return right.score - left.score
    || right.relevance - left.relevance
    || (statusPriority.get(left.record.status) ?? statusPriority.size)
      - (statusPriority.get(right.record.status) ?? statusPriority.size)
    || compareOptionalDateDescending(left.releaseDate, right.releaseDate)
    || compareText(left.record.name, right.record.name)
    || compareText(left.record.id, right.record.id);
}

function searchFields(record: CatalogModelRecord): SearchField[] {
  const fields: SearchField[] = [
    field("id", record.id, 1, true),
    field("name", record.name, 1, true),
    ...record.aliases.map(value => field("alias", value, 1, true)),
    field("publisher", record.publisher ?? "", 0.98, true),
    field("family", record.family ?? "", 0.98, true),
    field("type", record.type, 0.9),
    field("status", record.status, 0.86),
    field("license", record.license ?? "", 0.84),
    ...record.tasks.map(value => field("task", value, 0.94)),
    ...record.use_cases.map(value => field("use case", value, 0.94)),
    ...record.modalities.input.map(value => field("input modality", value, 0.9)),
    ...record.modalities.output.map(value => field("output modality", value, 0.9)),
    ...record.rankings.map(value => field("leaderboard domain", value.domain, 0.92)),
    ...record.rankings.map(value => field("leaderboard category", value.category, 0.88)),
    ...record.benchmarks.map(value => field("benchmark", value.name, 0.92)),
    field("description", record.description, 0.76),
  ];

  for (const [name, value] of Object.entries(record.capabilities)) {
    const objectValue = isRecord(value) ? value : undefined;
    if (value === true || objectValue?.supported === true) {
      fields.push(field("capability", name.replaceAll("_", " "), 0.94));
    }
    if (name === "reasoning" && objectValue) {
      const effort = Array.isArray(objectValue.effort) ? objectValue.effort : [];
      for (const level of effort) fields.push(field("reasoning effort", `${String(level)} reasoning`, 0.94));
      if (objectValue.toggle === true) fields.push(field("reasoning control", "reasoning toggle", 0.92));
      if (objectValue.budget) fields.push(field("reasoning control", "reasoning token budget", 0.92));
      if (typeof objectValue.description === "string") {
        fields.push(field("reasoning description", objectValue.description, 0.8));
      }
    }
  }
  for (const [cloud, availability] of Object.entries(record.availability)) {
    fields.push(field("cloud", cloud, 0.9));
    fields.push(field("availability", availability.status, 0.82));
    fields.push(...availability.serving_modes.map(mode => field("serving mode", mode, 0.9)));
    if (availability.details) fields.push(field("availability details", availability.details, 0.72));
  }
  for (const notice of record.notices) {
    fields.push(field("notice", notice.kind, 0.74));
    fields.push(field("notice", notice.title ?? "", 0.74));
    fields.push(field("notice", notice.text, 0.7));
  }
  return fields
    .map(value => ({ ...value, value: normalizeSearch(value.value) }))
    .filter(value => value.value.length > 0);
}

function field(name: string, value: string, weight: number, identity = false): SearchField {
  return { identity, name, value, weight };
}

function leaderboardScore(record: CatalogModelRecord, queryTokens: string[], referenceDate: string): number {
  const matched = record.rankings.filter(ranking => evidenceMatches(
    queryTokens,
    ranking.domain,
    ranking.category,
  ));
  const selected = matched.length
    ? matched
    : record.rankings.filter(ranking => ranking.category.toLowerCase() === "overall");
  if (!selected.length) return neutralScore;
  return aggregateEvidence(selected.map(ranking => ageAdjustedScore(
    rankScore(ranking.rank, 20),
    ranking.published_at ?? null,
    referenceDate,
    180,
    "votes" in ranking ? ranking.votes : ranking.observations,
    5_000,
  )));
}

function benchmarkScore(record: CatalogModelRecord, queryTokens: string[], referenceDate: string): number {
  const matched = record.benchmarks.filter(benchmark => evidenceMatches(queryTokens, benchmark.name));
  const selected = matched.length ? matched : record.benchmarks;
  if (!selected.length) return neutralScore;
  return aggregateEvidence(selected.map(benchmark => ageAdjustedScore(
    rankScore(benchmark.rank, 10),
    benchmark.published_at ?? null,
    referenceDate,
    365,
    benchmark.task_count,
    20,
  )));
}

function evidenceMatches(queryTokens: string[], ...values: string[]): boolean {
  if (!queryTokens.length) return false;
  const evidence = new Set(tokens(normalizeSearch(values.join(" "))));
  return queryTokens.some(token => evidence.has(token));
}

function ageAdjustedScore(
  score: number,
  publishedAt: string | null,
  referenceDate: string,
  halfLifeDays: number,
  confidenceCount: number | null | undefined,
  confidenceTarget: number,
): number {
  const ageDays = publishedAt
    ? Math.max(0, dateDays(referenceDate) - dateDays(publishedAt))
    : halfLifeDays;
  const ageFactor = 0.5 ** (ageDays / halfLifeDays);
  const confidence = confidenceCount === null || confidenceCount === undefined
    ? 0
    : Math.min(1, Math.log1p(confidenceCount) / Math.log1p(confidenceTarget));
  const evidenceFactor = ageFactor * (0.75 + confidence * 0.25);
  return neutralScore + (score - neutralScore) * evidenceFactor;
}

function aggregateEvidence(scores: number[]): number {
  if (!scores.length) return neutralScore;
  const aggregate = median(scores) * 0.6 + mean(scores) * 0.4;
  const coverageFactor = 0.85 + Math.min(scores.length, 5) / 5 * 0.15;
  return neutralScore + (aggregate - neutralScore) * coverageFactor;
}

function requestedVersionScore(candidate: number[], requested: number[]): number {
  if (!candidate.length) return 0;
  const [candidateMajor = 0, candidateMinor = 0, candidatePatch = 0] = candidate;
  const [requestedMajor = 0, requestedMinor = 0, requestedPatch = 0] = requested;
  if (candidateMajor !== requestedMajor) {
    return Math.max(0, 40 - Math.abs(candidateMajor - requestedMajor) * 15);
  }
  return Math.max(
    0,
    100
      - Math.abs(candidateMinor - requestedMinor) * 15
      - Math.abs(candidatePatch - requestedPatch) * 5,
  );
}

function versionDistance(candidate: number[], requested: number[]): number[] {
  if (!candidate.length) return [1, 1, 1_000, 1_000, 1_000];
  const [candidateMajor = 0, candidateMinor = 0, candidatePatch = 0] = candidate;
  const [requestedMajor = 0, requestedMinor = 0, requestedPatch = 0] = requested;
  return [
    0,
    candidateMajor === requestedMajor ? 0 : 1,
    Math.abs(candidateMajor - requestedMajor),
    Math.abs(candidateMinor - requestedMinor),
    Math.abs(candidatePatch - requestedPatch),
  ];
}

function weightedRatio(left: string, right: string): number {
  if (!left || !right) return 0;
  const lengthRatio = Math.max(left.length, right.length) / Math.min(left.length, right.length);
  const base = ratio(left, right);
  if (lengthRatio < 1.5) {
    return Math.max(base, tokenRatio(left, right) * 0.95);
  }
  const partialScale = lengthRatio <= 8 ? 0.9 : 0.6;
  return Math.max(
    base,
    partialRatio(left, right) * partialScale,
    partialTokenRatio(left, right) * 0.95 * partialScale,
  );
}

function tokenRatio(left: string, right: string): number {
  return Math.max(tokenSetRatio(left, right), ratio(sortTokens(left), sortTokens(right)));
}

function partialTokenRatio(left: string, right: string): number {
  const leftTokens = left.split(/\s+/).filter(Boolean);
  const rightTokens = right.split(/\s+/).filter(Boolean);
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  if ([...leftSet].some(token => rightSet.has(token))) return 100;
  const base = partialRatio([...leftTokens].sort().join(" "), [...rightTokens].sort().join(" "));
  const leftDiff = [...leftSet].filter(token => !rightSet.has(token));
  const rightDiff = [...rightSet].filter(token => !leftSet.has(token));
  if (leftTokens.length === leftDiff.length && rightTokens.length === rightDiff.length) return base;
  return Math.max(base, partialRatio(leftDiff.sort().join(" "), rightDiff.sort().join(" ")));
}

function tokenSetRatio(left: string, right: string): number {
  const leftSet = new Set(left.split(/\s+/).filter(Boolean));
  const rightSet = new Set(right.split(/\s+/).filter(Boolean));
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter(token => rightSet.has(token));
  const leftDiff = [...leftSet].filter(token => !rightSet.has(token)).sort().join(" ");
  const rightDiff = [...rightSet].filter(token => !leftSet.has(token)).sort().join(" ");
  if (intersection.length && (!leftDiff || !rightDiff)) return 100;
  const intersectionLength = intersection.join(" ").length;
  const leftLength = intersectionLength + (intersectionLength ? 1 : 0) + leftDiff.length;
  const rightLength = intersectionLength + (intersectionLength ? 1 : 0) + rightDiff.length;
  const distance = indelDistance(leftDiff, rightDiff);
  const differenceScore = normalizedDistanceScore(distance, leftLength + rightLength);
  if (!intersectionLength) return differenceScore;
  const leftIntersectionScore = normalizedDistanceScore(
    1 + leftDiff.length,
    intersectionLength + leftLength,
  );
  const rightIntersectionScore = normalizedDistanceScore(
    1 + rightDiff.length,
    intersectionLength + rightLength,
  );
  return Math.max(differenceScore, leftIntersectionScore, rightIntersectionScore);
}

function partialRatio(left: string, right: string): number {
  if (!left && !right) return 100;
  if (!left || !right) return 0;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  let best = 0;
  for (let end = 1; end < shorter.length; end += 1) {
    best = Math.max(best, ratio(shorter, longer.slice(0, end)));
  }
  for (let start = 0; start <= longer.length - shorter.length; start += 1) {
    best = Math.max(best, ratio(shorter, longer.slice(start, start + shorter.length)));
  }
  for (let start = Math.max(0, longer.length - shorter.length + 1); start < longer.length; start += 1) {
    best = Math.max(best, ratio(shorter, longer.slice(start)));
  }
  return best;
}

function ratio(left: string, right: string): number {
  const total = left.length + right.length;
  return total ? (2 * longestCommonSubsequence(left, right) / total) * 100 : 100;
}

function indelDistance(left: string, right: string): number {
  return left.length + right.length - 2 * longestCommonSubsequence(left, right);
}

function longestCommonSubsequence(left: string, right: string): number {
  if (!left || !right) return 0;
  const needle = left.length <= right.length ? left : right;
  const haystack = left.length <= right.length ? right : left;
  const blocks = new Map<string, bigint>();
  let bit = 1n;
  for (const character of needle) {
    blocks.set(character, (blocks.get(character) ?? 0n) | bit);
    bit <<= 1n;
  }
  let state = (1n << BigInt(needle.length)) - 1n;
  for (const character of haystack) {
    const matches = blocks.get(character) ?? 0n;
    const overlap = state & matches;
    state = (state + overlap) | (state - overlap);
  }
  const mask = (1n << BigInt(needle.length)) - 1n;
  return needle.length - popCount(state & mask);
}

function popCount(value: bigint): number {
  let count = 0;
  let current = value;
  while (current) {
    current &= current - 1n;
    count += 1;
  }
  return count;
}

function normalizedDistanceScore(distance: number, lengthSum: number): number {
  return lengthSum ? 100 - 100 * distance / lengthSum : 100;
}

function sortTokens(value: string): string {
  return value.split(/\s+/).filter(Boolean).sort().join(" ");
}

function normalizeSearch(value: string): string {
  return (value.normalize("NFKC").toLowerCase().match(tokenPattern) ?? []).join(" ");
}

function tokens(value: string): string[] {
  return value.match(tokenPattern) ?? [];
}

function version(value: string): number[] {
  const match = versionPattern.exec(value.toLowerCase());
  return match
    ? match.slice(1).filter((part): part is string => Boolean(part)).map(Number)
    : [];
}

function rankScore(rank: number, offset: number): number {
  return (offset + 1) / (offset + rank) * 100;
}

function dateDays(value: string): number {
  return Math.floor(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function compareNumbers(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function compareOptionalDateDescending(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left);
}

function compareText(left: string, right: string): number {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
