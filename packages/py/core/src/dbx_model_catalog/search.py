from __future__ import annotations

import math
import re
import statistics
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from rapidfuzz import fuzz

from .models import CatalogModelRecord, ModelCatalog

SearchMatchKind = Literal["exact", "token", "fuzzy"]

_TOKEN_PATTERN = re.compile(r"[a-z]+|\d+")
_VERSION_PATTERN = re.compile(
    r"(?<![a-z0-9])(\d+)(?:[.\-_](\d+))?(?:[.\-_](\d+))?(?![a-z0-9])",
    re.IGNORECASE,
)
_STATUS_SCORE = {
    "active": 100.0,
    "preview": 85.0,
    "beta": 85.0,
    "alpha": 70.0,
    "legacy": 40.0,
    "deprecated": 15.0,
    "retired": 0.0,
}
_STATUS_PRIORITY = {
    status: position for position, status in enumerate(_STATUS_SCORE)
}
_SEARCH_INDEX_SCHEMA_VERSION = 1
_NEUTRAL_SCORE = 50.0


class CatalogSearchWeights(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    relevance: float
    leaderboard: float
    benchmark: float
    version: float
    freshness: float
    lifecycle: float


SEARCH_WEIGHTS = CatalogSearchWeights(
    relevance=0.70,
    leaderboard=0.04,
    benchmark=0.08,
    version=0.08,
    freshness=0.07,
    lifecycle=0.03,
)


class CatalogSearchScores(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relevance: float = Field(ge=0, le=100)
    leaderboard: float = Field(ge=0, le=100)
    benchmark: float = Field(ge=0, le=100)
    version: float = Field(ge=0, le=100)
    freshness: float = Field(ge=0, le=100)
    lifecycle: float = Field(ge=0, le=100)


class CatalogSearchQualityScores(BaseModel):
    model_config = ConfigDict(extra="forbid")

    leaderboard: float = Field(ge=0, le=100)
    benchmark: float = Field(ge=0, le=100)
    version: float = Field(ge=0, le=100)
    freshness: float = Field(ge=0, le=100)
    lifecycle: float = Field(ge=0, le=100)


class CatalogSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record: CatalogModelRecord
    score: float = Field(ge=0, le=100)
    match: SearchMatchKind
    matched_fields: list[str]
    scores: CatalogSearchScores


class CatalogSearchIndexDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    exact_identities: list[str]
    identities: list[str]
    keywords: str
    description: str
    tokens: list[str]
    family: str | None = None
    version: list[int]
    quality_score: float = Field(ge=0, le=100)
    scores: CatalogSearchQualityScores


class CatalogSearchIndexPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int
    catalog_schema_version: int
    updated_at: AwareDatetime
    weights: CatalogSearchWeights
    documents: list[CatalogSearchIndexDocument]


@dataclass(frozen=True)
class _SearchField:
    name: str
    value: str
    weight: float
    identity: bool = False


@dataclass(frozen=True)
class _IndexedField:
    name: str
    value: str
    tokens: frozenset[str]
    weight: float
    identity: bool


@dataclass(frozen=True)
class _IndexedRecord:
    record: CatalogModelRecord
    fields: tuple[_IndexedField, ...]
    identity_tokens: frozenset[str]
    all_tokens: frozenset[str]
    version: tuple[int, ...]
    freshness_date: date | None


@dataclass(frozen=True)
class _ScoredRecord:
    result: CatalogSearchResult
    identity_exact: bool
    version: tuple[int, ...]
    release_date: date | None


class CatalogSearchIndex:
    """Precomputed searchable fields and quality signals for one catalog snapshot."""

    def __init__(
        self,
        records: list[CatalogModelRecord],
        *,
        reference_date: date | None = None,
    ) -> None:
        self._records = tuple(_index_record(record) for record in records)
        self._reference_date = reference_date or _reference_date(self._records)
        self._family_versions = _family_versions(self._records)
        self._freshness_range = _freshness_range(self._records)
        self._quality_scores = {
            indexed.record.id: self._quality_for(indexed) for indexed in self._records
        }

    @classmethod
    def from_catalog(cls, catalog: ModelCatalog) -> CatalogSearchIndex:
        records = [
            CatalogModelRecord(id=model_id, **model.model_dump())
            for model_id, model in catalog.models.items()
        ]
        return cls(records, reference_date=catalog.updated_at.date())

    def search(
        self,
        query: str,
        *,
        limit: int | None = 50,
        score_cutoff: float = 58,
        record_ids: set[str] | None = None,
    ) -> list[CatalogSearchResult]:
        normalized_query = _normalize(query)
        if not normalized_query or limit == 0:
            return []

        query_tokens = _tokens(normalized_query)
        query_text_tokens = [token for token in query_tokens if not token.isdigit()]
        requested_version = _version(query)
        scored = [
            candidate
            for indexed in self._records
            if record_ids is None or indexed.record.id in record_ids
            if (
                candidate := self._score_record(
                    indexed,
                    normalized_query,
                    query_text_tokens,
                    requested_version,
                    score_cutoff,
                )
            )
        ]
        scored.sort(key=lambda candidate: _sort_key(candidate, requested_version))
        results = [candidate.result for candidate in scored]
        return results if limit is None else results[:limit]

    def payload(
        self,
        *,
        catalog_schema_version: int,
        updated_at: datetime,
    ) -> CatalogSearchIndexPayload:
        documents = []
        for indexed in self._records:
            quality = self._quality_scores[indexed.record.id]
            identity_values = list(
                dict.fromkeys(field.value for field in indexed.fields if field.identity)
            )
            exact_identity_values = list(
                dict.fromkeys(
                    field.value
                    for field in indexed.fields
                    if field.name in {"id", "name", "alias"}
                )
            )
            keyword_values = [
                field.value
                for field in indexed.fields
                if field.name not in {"description", "notice"}
            ]
            description_values = [
                field.value
                for field in indexed.fields
                if field.name in {"description", "notice"}
            ]
            documents.append(
                CatalogSearchIndexDocument(
                    id=indexed.record.id,
                    exact_identities=exact_identity_values,
                    identities=identity_values,
                    keywords=" ".join(dict.fromkeys(keyword_values)),
                    description=" ".join(dict.fromkeys(description_values)),
                    tokens=sorted(indexed.all_tokens),
                    family=indexed.record.family,
                    version=list(indexed.version),
                    quality_score=round(_quality_score(quality), 3),
                    scores=CatalogSearchQualityScores(**_rounded_values(quality)),
                )
            )
        return CatalogSearchIndexPayload(
            schema_version=_SEARCH_INDEX_SCHEMA_VERSION,
            catalog_schema_version=catalog_schema_version,
            updated_at=updated_at,
            weights=SEARCH_WEIGHTS,
            documents=documents,
        )

    def _score_record(
        self,
        indexed: _IndexedRecord,
        query: str,
        query_text_tokens: list[str],
        requested_version: tuple[int, ...],
        score_cutoff: float,
    ) -> _ScoredRecord | None:
        field_scores = _field_scores(indexed, query, query_text_tokens)
        if not field_scores:
            return None
        token_scores = _query_token_scores(query_text_tokens, indexed.all_tokens)
        if not _passes_token_gate(
            indexed,
            query_text_tokens,
            token_scores,
            require_identity=bool(requested_version),
        ):
            return None
        relevance = _relevance_score(field_scores, token_scores)
        if relevance < score_cutoff:
            return None
        match, matched_fields, identity_match, identity_exact = _match_summary(
            field_scores,
            relevance,
            query_text_tokens,
            indexed.identity_tokens,
        )
        quality = self._query_quality(
            indexed,
            query_text_tokens,
            requested_version,
            identity_match,
        )
        scores = CatalogSearchScores(
            relevance=relevance,
            **quality.model_dump(),
        )
        return _scored_record(
            indexed,
            scores,
            match,
            matched_fields,
            identity_exact,
        )

    def _quality_for(self, indexed: _IndexedRecord) -> CatalogSearchQualityScores:
        return CatalogSearchQualityScores(
            leaderboard=_leaderboard_score(
                indexed.record,
                [],
                self._reference_date,
            ),
            benchmark=_benchmark_score(
                indexed.record,
                [],
                self._reference_date,
            ),
            version=_family_version_score(
                indexed,
                self._family_versions,
            ),
            freshness=_freshness_score(
                indexed.freshness_date,
                self._freshness_range,
            ),
            lifecycle=_STATUS_SCORE.get(indexed.record.status.value, _NEUTRAL_SCORE),
        )

    def _query_quality(
        self,
        indexed: _IndexedRecord,
        query_text_tokens: list[str],
        requested_version: tuple[int, ...],
        identity_match: bool,
    ) -> CatalogSearchQualityScores:
        base_quality = self._quality_scores[indexed.record.id]
        if requested_version:
            version = _requested_version_score(indexed.version, requested_version)
        elif identity_match:
            version = base_quality.version
        else:
            version = _NEUTRAL_SCORE
        return CatalogSearchQualityScores(
            leaderboard=_leaderboard_score(
                indexed.record,
                query_text_tokens,
                self._reference_date,
            ),
            benchmark=_benchmark_score(
                indexed.record,
                query_text_tokens,
                self._reference_date,
            ),
            version=version,
            freshness=base_quality.freshness,
            lifecycle=base_quality.lifecycle,
        )


def search_catalog_records(
    records: list[CatalogModelRecord],
    query: str,
    *,
    limit: int | None = 50,
    score_cutoff: float = 58,
) -> list[CatalogSearchResult]:
    return CatalogSearchIndex(records).search(
        query,
        limit=limit,
        score_cutoff=score_cutoff,
    )


def build_catalog_search_index(catalog: ModelCatalog) -> CatalogSearchIndexPayload:
    return CatalogSearchIndex.from_catalog(catalog).payload(
        catalog_schema_version=catalog.schema_version,
        updated_at=catalog.updated_at,
    )


def _index_record(record: CatalogModelRecord) -> _IndexedRecord:
    fields = tuple(
        _IndexedField(
            name=field.name,
            value=normalized,
            tokens=frozenset(_tokens(normalized)),
            weight=field.weight,
            identity=field.identity,
        )
        for field in _search_fields(record)
        if (normalized := _normalize(field.value))
    )
    identity_tokens = frozenset(
        token
        for field in fields
        if field.identity
        for token in field.tokens
    )
    all_tokens = frozenset(token for field in fields for token in field.tokens)
    return _IndexedRecord(
        record=record,
        fields=fields,
        identity_tokens=identity_tokens,
        all_tokens=all_tokens,
        version=_version(record.name) or _version(record.id),
        freshness_date=max(
            (value for value in (record.last_updated, record.release_date) if value),
            default=None,
        ),
    )


def _field_scores(
    indexed: _IndexedRecord,
    query: str,
    query_text_tokens: list[str],
) -> list[tuple[float, _IndexedField, SearchMatchKind]]:
    requested_tokens = set(query_text_tokens)
    return [
        _field_score(field, query, requested_tokens)
        for field in indexed.fields
    ]


def _field_score(
    field: _IndexedField,
    query: str,
    requested_tokens: set[str],
) -> tuple[float, _IndexedField, SearchMatchKind]:
    weighted = max(
        fuzz.WRatio(query, field.value),
        fuzz.token_set_ratio(query, field.value),
    ) * field.weight
    if query == field.value:
        return 100, field, "exact"
    if query in field.value:
        return max(weighted, 96 * field.weight), field, "token"
    if requested_tokens and requested_tokens.issubset(field.tokens):
        return max(weighted, 94 * field.weight), field, "token"
    return weighted, field, "fuzzy"


def _query_token_scores(
    query_tokens: list[str],
    candidate_tokens: frozenset[str],
) -> list[float]:
    return [
        max(
            (fuzz.ratio(token, candidate) for candidate in candidate_tokens),
            default=0,
        )
        for token in query_tokens
    ]


def _passes_token_gate(
    indexed: _IndexedRecord,
    query_tokens: list[str],
    token_scores: list[float],
    *,
    require_identity: bool,
) -> bool:
    if any(
        score < (80 if len(token) <= 3 else 65)
        for token, score in zip(query_tokens, token_scores, strict=True)
    ):
        return False
    if not require_identity or not query_tokens:
        return True
    identity_scores = _query_token_scores(query_tokens, indexed.identity_tokens)
    return min(identity_scores) >= 75


def _relevance_score(
    field_scores: list[tuple[float, _IndexedField, SearchMatchKind]],
    token_scores: list[float],
) -> float:
    relevance = max(score for score, _, _ in field_scores)
    if not token_scores:
        return relevance
    return max(relevance, statistics.fmean(token_scores) * 0.94)


def _match_summary(
    field_scores: list[tuple[float, _IndexedField, SearchMatchKind]],
    relevance: float,
    query_tokens: list[str],
    identity_tokens: frozenset[str],
) -> tuple[SearchMatchKind, list[str], bool, bool]:
    leading = [item for item in field_scores if item[0] >= relevance - 8]
    matched_fields = list(
        dict.fromkeys(field.name for _, field, _ in leading)
    )[:5]
    kinds = {kind for _, _, kind in leading}
    match: SearchMatchKind = (
        "exact"
        if "exact" in kinds
        else "token"
        if "token" in kinds
        else "fuzzy"
    )
    identity_match = (
        bool(query_tokens) and set(query_tokens).issubset(identity_tokens)
    ) or any(field.identity for _, field, _ in leading)
    identity_exact = any(
        kind == "exact" and field.name in {"id", "name", "alias"}
        for _, field, kind in leading
    )
    return match, matched_fields, identity_match, identity_exact


def _scored_record(
    indexed: _IndexedRecord,
    scores: CatalogSearchScores,
    match: SearchMatchKind,
    matched_fields: list[str],
    identity_exact: bool,
) -> _ScoredRecord:
    result = CatalogSearchResult(
        record=indexed.record,
        score=round(_combined_score(scores), 3),
        match=match,
        matched_fields=matched_fields,
        scores=CatalogSearchScores(**_rounded_values(scores)),
    )
    return _ScoredRecord(
        result=result,
        identity_exact=identity_exact,
        version=indexed.version,
        release_date=indexed.record.release_date,
    )


def _sort_key(
    candidate: _ScoredRecord,
    requested_version: tuple[int, ...],
) -> tuple[object, ...]:
    record = candidate.result.record
    requested_key = (
        _version_distance(candidate.version, requested_version)
        if requested_version
        else ()
    )
    release_ordinal = candidate.release_date.toordinal() if candidate.release_date else 0
    return (
        0 if candidate.identity_exact else 1,
        *requested_key,
        -candidate.result.score,
        -candidate.result.scores.relevance,
        _STATUS_PRIORITY.get(record.status.value, len(_STATUS_PRIORITY)),
        -release_ordinal,
        record.name.casefold(),
        record.id.casefold(),
    )


def _combined_score(scores: CatalogSearchScores) -> float:
    return sum(
        getattr(scores, name) * weight
        for name, weight in SEARCH_WEIGHTS.model_dump().items()
    )


def _quality_score(scores: CatalogSearchQualityScores) -> float:
    quality_weights = SEARCH_WEIGHTS.model_dump(exclude={"relevance"})
    total = sum(quality_weights.values())
    return sum(
        getattr(scores, name) * weight
        for name, weight in quality_weights.items()
    ) / total


def _family_versions(
    records: tuple[_IndexedRecord, ...],
) -> dict[str, tuple[tuple[int, ...], ...]]:
    grouped: dict[str, set[tuple[int, ...]]] = {}
    for indexed in records:
        family = _normalize(indexed.record.family or "")
        if family and indexed.version:
            grouped.setdefault(family, set()).add(indexed.version)
    return {
        family: tuple(sorted(versions))
        for family, versions in grouped.items()
    }


def _family_version_score(
    indexed: _IndexedRecord,
    family_versions: dict[str, tuple[tuple[int, ...], ...]],
) -> float:
    family = _normalize(indexed.record.family or "")
    versions = family_versions.get(family, ())
    if not indexed.version or len(versions) < 2:
        return _NEUTRAL_SCORE
    position = versions.index(indexed.version)
    return 25 + 75 * position / (len(versions) - 1)


def _requested_version_score(
    candidate: tuple[int, ...],
    requested: tuple[int, ...],
) -> float:
    if not candidate:
        return 0.0
    left = (*candidate, 0, 0, 0)[:3]
    right = (*requested, 0, 0, 0)[:3]
    if left[0] != right[0]:
        return max(0.0, 40.0 - abs(left[0] - right[0]) * 15.0)
    return max(
        0.0,
        100.0
        - abs(left[1] - right[1]) * 15.0
        - abs(left[2] - right[2]) * 5.0,
    )


def _version_distance(
    candidate: tuple[int, ...],
    requested: tuple[int, ...],
) -> tuple[int, ...]:
    if not candidate:
        return (1, 1, 1_000, 1_000, 1_000)
    padded_candidate = (*candidate, 0, 0, 0)[:3]
    padded_requested = (*requested, 0, 0, 0)[:3]
    return (
        0,
        0 if padded_candidate[0] == padded_requested[0] else 1,
        abs(padded_candidate[0] - padded_requested[0]),
        abs(padded_candidate[1] - padded_requested[1]),
        abs(padded_candidate[2] - padded_requested[2]),
    )


def _freshness_range(
    records: tuple[_IndexedRecord, ...],
) -> tuple[int, int] | None:
    ordinals = [
        indexed.freshness_date.toordinal()
        for indexed in records
        if indexed.freshness_date
    ]
    return (min(ordinals), max(ordinals)) if ordinals else None


def _freshness_score(
    value: date | None,
    observed_range: tuple[int, int] | None,
) -> float:
    if value is None or observed_range is None:
        return _NEUTRAL_SCORE
    minimum, maximum = observed_range
    if minimum == maximum:
        return _NEUTRAL_SCORE
    return 25 + 75 * (value.toordinal() - minimum) / (maximum - minimum)


def _reference_date(records: tuple[_IndexedRecord, ...]) -> date:
    dates = [
        value
        for indexed in records
        for value in (
            indexed.freshness_date,
            *(ranking.published_at for ranking in indexed.record.rankings),
            *(benchmark.published_at for benchmark in indexed.record.benchmarks),
        )
        if value
    ]
    return max(dates, default=date.today())


def _leaderboard_score(
    record: CatalogModelRecord,
    query_tokens: list[str],
    reference_date: date,
) -> float:
    rankings = list(record.rankings)
    matched = [
        ranking
        for ranking in rankings
        if _evidence_matches(query_tokens, ranking.domain, ranking.category)
    ]
    selected = matched or [
        ranking
        for ranking in rankings
        if ranking.category.casefold() == "overall"
    ]
    if not selected:
        return _NEUTRAL_SCORE
    scores = [
        _age_adjusted_score(
            _rank_score(ranking.rank, offset=20),
            ranking.published_at,
            reference_date,
            half_life_days=180,
            confidence_count=(
                getattr(ranking, "votes", None)
                or getattr(ranking, "observations", None)
            ),
            confidence_target=5_000,
        )
        for ranking in selected
    ]
    return _aggregate_evidence(scores)


def _benchmark_score(
    record: CatalogModelRecord,
    query_tokens: list[str],
    reference_date: date,
) -> float:
    benchmarks = list(record.benchmarks)
    matched = [
        benchmark
        for benchmark in benchmarks
        if _evidence_matches(query_tokens, benchmark.name)
    ]
    selected = matched or benchmarks
    if not selected:
        return _NEUTRAL_SCORE
    scores = [
        _age_adjusted_score(
            _rank_score(benchmark.rank, offset=10),
            benchmark.published_at,
            reference_date,
            half_life_days=365,
            confidence_count=benchmark.task_count,
            confidence_target=20,
        )
        for benchmark in selected
    ]
    return _aggregate_evidence(scores)


def _rank_score(rank: int, *, offset: int) -> float:
    return (offset + 1) / (offset + rank) * 100


def _age_adjusted_score(
    score: float,
    published_at: date | None,
    reference_date: date,
    *,
    half_life_days: int,
    confidence_count: int | None,
    confidence_target: int,
) -> float:
    age_days = (
        max(0, (reference_date - published_at).days)
        if published_at
        else half_life_days
    )
    age_factor = 0.5 ** (age_days / half_life_days)
    confidence = (
        min(1.0, math.log1p(confidence_count) / math.log1p(confidence_target))
        if confidence_count is not None
        else 0.0
    )
    evidence_factor = age_factor * (0.75 + confidence * 0.25)
    return _NEUTRAL_SCORE + (score - _NEUTRAL_SCORE) * evidence_factor


def _aggregate_evidence(scores: list[float]) -> float:
    if not scores:
        return _NEUTRAL_SCORE
    aggregate = statistics.median(scores) * 0.6 + statistics.fmean(scores) * 0.4
    coverage_factor = 0.85 + min(len(scores), 5) / 5 * 0.15
    return _NEUTRAL_SCORE + (aggregate - _NEUTRAL_SCORE) * coverage_factor


def _evidence_matches(query_tokens: list[str], *values: str) -> bool:
    if not query_tokens:
        return False
    evidence_tokens = set(_tokens(_normalize(" ".join(values))))
    return bool(evidence_tokens.intersection(query_tokens))


def _search_fields(record: CatalogModelRecord) -> list[_SearchField]:
    return [
        *_base_search_fields(record),
        *_capability_search_fields(record),
        *_availability_search_fields(record),
        *_notice_search_fields(record),
    ]


def _base_search_fields(record: CatalogModelRecord) -> list[_SearchField]:
    return [
        _SearchField("id", record.id, 1, True),
        _SearchField("name", record.name, 1, True),
        *(_SearchField("alias", alias, 1, True) for alias in record.aliases),
        _SearchField("publisher", record.publisher or "", 0.98, True),
        _SearchField("family", record.family or "", 0.98, True),
        _SearchField("type", record.type.value, 0.9),
        _SearchField("status", record.status.value, 0.86),
        _SearchField("license", record.license or "", 0.84),
        *(_SearchField("task", value, 0.94) for value in record.tasks),
        *(_SearchField("use case", value, 0.94) for value in record.use_cases),
        *(
            _SearchField("input modality", str(value), 0.9)
            for value in record.modalities.input
        ),
        *(
            _SearchField("output modality", str(value), 0.9)
            for value in record.modalities.output
        ),
        *(
            _SearchField("leaderboard domain", ranking.domain, 0.92)
            for ranking in record.rankings
        ),
        *(
            _SearchField("leaderboard category", ranking.category, 0.88)
            for ranking in record.rankings
        ),
        *(
            _SearchField("benchmark", benchmark.name, 0.92)
            for benchmark in record.benchmarks
        ),
        _SearchField("description", record.description, 0.76),
    ]


def _capability_search_fields(record: CatalogModelRecord) -> list[_SearchField]:
    fields = []
    for capability, value in record.capabilities.model_dump(mode="python").items():
        supported = value is True or (
            isinstance(value, dict) and value.get("supported") is True
        )
        if supported:
            fields.append(
                _SearchField("capability", capability.replace("_", " "), 0.94)
            )
    return fields


def _availability_search_fields(record: CatalogModelRecord) -> list[_SearchField]:
    fields = []
    for cloud, availability in record.availability.items():
        fields.append(_SearchField("cloud", cloud, 0.9))
        fields.append(_SearchField("availability", str(availability.status), 0.82))
        fields.extend(
            _SearchField("serving mode", str(mode), 0.9)
            for mode in availability.serving_modes
        )
        if availability.details:
            fields.append(
                _SearchField("availability details", availability.details, 0.72)
            )
    return fields


def _notice_search_fields(record: CatalogModelRecord) -> list[_SearchField]:
    fields = []
    for notice in record.notices:
        fields.append(_SearchField("notice", str(notice.kind), 0.74))
        fields.append(_SearchField("notice", notice.title or "", 0.74))
        fields.append(_SearchField("notice", notice.text, 0.7))
    return fields


def _rounded_values(
    scores: CatalogSearchScores | CatalogSearchQualityScores,
) -> dict[str, float]:
    return {
        name: round(value, 3)
        for name, value in scores.model_dump().items()
    }


def _normalize(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(_TOKEN_PATTERN.findall(normalized))


def _tokens(value: str) -> list[str]:
    return _TOKEN_PATTERN.findall(value)


def _version(value: str) -> tuple[int, ...]:
    match = _VERSION_PATTERN.search(value.casefold())
    if match is None:
        return ()
    return tuple(int(part) for part in match.groups() if part is not None)


__all__ = [
    "CatalogSearchIndex",
    "CatalogSearchIndexDocument",
    "CatalogSearchIndexPayload",
    "CatalogSearchQualityScores",
    "CatalogSearchResult",
    "CatalogSearchScores",
    "CatalogSearchWeights",
    "SEARCH_WEIGHTS",
    "SearchMatchKind",
    "build_catalog_search_index",
    "search_catalog_records",
]
