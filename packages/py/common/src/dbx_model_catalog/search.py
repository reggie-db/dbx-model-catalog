from __future__ import annotations

import re
import statistics
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from rapidfuzz import fuzz

from .models import CatalogModelRecord

SearchMatchKind = Literal["exact", "token", "fuzzy"]

_TOKEN_PATTERN = re.compile(r"[a-z]+|\d+")
_VERSION_PATTERN = re.compile(
    r"(?<![a-z0-9])(\d+)(?:[.\-_](\d+))?(?:[.\-_](\d+))?(?![a-z0-9])",
    re.IGNORECASE,
)
_STATUS_PRIORITY = {
    "active": 0,
    "preview": 1,
    "beta": 2,
    "alpha": 3,
    "legacy": 4,
    "deprecated": 5,
    "retired": 6,
}


class CatalogSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record: CatalogModelRecord
    score: float = Field(ge=0, le=100)
    match: SearchMatchKind
    matched_fields: list[str]


@dataclass(frozen=True)
class _SearchField:
    name: str
    value: str
    weight: float
    identity: bool = False


@dataclass(frozen=True)
class _ScoredRecord:
    result: CatalogSearchResult
    identity_match: bool
    version: tuple[int, ...]
    overall_rank: tuple[float, float, int, int]
    release_date: date | None


def search_catalog_records(
    records: list[CatalogModelRecord],
    query: str,
    *,
    limit: int | None = 50,
    score_cutoff: float = 58,
) -> list[CatalogSearchResult]:
    normalized_query = _normalize(query)
    if not normalized_query or limit == 0:
        return []

    query_tokens = _tokens(normalized_query)
    query_text_tokens = [token for token in query_tokens if not token.isdigit()]
    requested_version = _version(query)
    scored = [
        candidate
        for record in records
        if (
            candidate := _score_record(
                record,
                normalized_query,
                query_text_tokens,
                bool(requested_version),
                score_cutoff,
            )
        )
    ]
    scored.sort(key=lambda candidate: _sort_key(candidate, requested_version))
    results = [candidate.result for candidate in scored]
    return results if limit is None else results[:limit]


def _score_record(
    record: CatalogModelRecord,
    query: str,
    query_text_tokens: list[str],
    require_identity: bool,
    score_cutoff: float,
) -> _ScoredRecord | None:
    fields = _search_fields(record)
    field_scores: list[tuple[float, _SearchField, SearchMatchKind]] = []
    identity_tokens: set[str] = set()
    all_tokens: set[str] = set()

    for field in fields:
        value = _normalize(field.value)
        if not value:
            continue
        value_tokens = set(_tokens(value))
        all_tokens.update(value_tokens)
        if field.identity:
            identity_tokens.update(value_tokens)

        weighted = max(
            fuzz.WRatio(query, value),
            fuzz.token_set_ratio(query, value),
        ) * field.weight
        match: SearchMatchKind = "fuzzy"
        if query == value:
            weighted = 100
            match = "exact"
        elif query in value:
            weighted = max(weighted, 96 * field.weight)
            match = "token"
        elif query_text_tokens and set(query_text_tokens).issubset(value_tokens):
            weighted = max(weighted, 94 * field.weight)
            match = "token"
        field_scores.append((weighted, field, match))

    if not field_scores:
        return None

    token_scores = [
        max((fuzz.ratio(token, candidate) for candidate in all_tokens), default=0)
        for token in query_text_tokens
    ]
    if token_scores and any(
        score < (80 if len(token) <= 3 else 65)
        for token, score in zip(query_text_tokens, token_scores, strict=True)
    ):
        return None
    if require_identity and query_text_tokens:
        identity_scores = [
            max((fuzz.ratio(token, candidate) for candidate in identity_tokens), default=0)
            for token in query_text_tokens
        ]
        if min(identity_scores) < 75:
            return None

    best_score = max(score for score, _, _ in field_scores)
    if token_scores:
        best_score = max(best_score, sum(token_scores) / len(token_scores) * 0.94)
    if best_score < score_cutoff:
        return None

    leading = [item for item in field_scores if item[0] >= best_score - 8]
    matched_fields = list(dict.fromkeys(field.name for _, field, _ in leading))[:5]
    match: SearchMatchKind = (
        "exact"
        if any(kind == "exact" for _, _, kind in leading)
        else "token"
        if any(kind == "token" for _, _, kind in leading)
        else "fuzzy"
    )
    identity_match = (
        bool(query_text_tokens)
        and set(query_text_tokens).issubset(identity_tokens)
    ) or any(field.identity for _, field, _ in leading)
    result = CatalogSearchResult(
        record=record,
        score=round(min(best_score, 100), 3),
        match=match,
        matched_fields=matched_fields,
    )
    return _ScoredRecord(
        result=result,
        identity_match=identity_match,
        version=_version(record.name) or _version(record.id),
        overall_rank=_overall_rank(record),
        release_date=record.release_date,
    )


def _sort_key(
    candidate: _ScoredRecord,
    requested_version: tuple[int, ...],
) -> tuple[object, ...]:
    record = candidate.result.record
    if requested_version:
        version_key = _version_distance(candidate.version, requested_version)
    elif candidate.identity_match:
        padded = (*candidate.version, 0, 0, 0)[:3]
        version_key = (0, *(-part for part in padded))
    else:
        version_key = (0, 0, 0, 0)
    release_ordinal = candidate.release_date.toordinal() if candidate.release_date else 0
    return (
        -candidate.result.score,
        _STATUS_PRIORITY.get(record.status.value, len(_STATUS_PRIORITY)),
        *version_key,
        *candidate.overall_rank,
        -release_ordinal,
        record.name.casefold(),
        record.id.casefold(),
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


def _overall_rank(record: CatalogModelRecord) -> tuple[float, float, int, int]:
    ranks = [
        ranking.rank
        for ranking in record.rankings
        if ranking.category.casefold() == "overall"
    ]
    if not ranks:
        missing = float(2**31 - 1)
        return (missing, missing, 2**31 - 1, 0)
    return (
        statistics.median(ranks),
        statistics.fmean(ranks),
        min(ranks),
        -len(ranks),
    )


def _search_fields(record: CatalogModelRecord) -> list[_SearchField]:
    fields = [
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
        *(_SearchField("input modality", str(value), 0.9) for value in record.modalities.input),
        *(_SearchField("output modality", str(value), 0.9) for value in record.modalities.output),
        *(_SearchField("ranking domain", ranking.domain, 0.92) for ranking in record.rankings),
        *(_SearchField("ranking category", ranking.category, 0.88) for ranking in record.rankings),
        *(_SearchField("benchmark", benchmark.name, 0.92) for benchmark in record.benchmarks),
        _SearchField("description", record.description, 0.76),
    ]
    for capability, value in record.capabilities.model_dump(mode="python").items():
        supported = value is True or (
            isinstance(value, dict) and value.get("supported") is True
        )
        if supported:
            fields.append(_SearchField("capability", capability.replace("_", " "), 0.94))
    for cloud, availability in record.availability.items():
        fields.append(_SearchField("cloud", cloud, 0.9))
        fields.append(_SearchField("availability", str(availability.status), 0.82))
        fields.extend(
            _SearchField("serving mode", str(mode), 0.9)
            for mode in availability.serving_modes
        )
        if availability.details:
            fields.append(_SearchField("availability details", availability.details, 0.72))
    for notice in record.notices:
        fields.append(_SearchField("notice", str(notice.kind), 0.74))
        fields.append(_SearchField("notice", notice.title or "", 0.74))
        fields.append(_SearchField("notice", notice.text, 0.7))
    return fields


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
    "CatalogSearchResult",
    "SearchMatchKind",
    "search_catalog_records",
]
