from __future__ import annotations

import re
import statistics
from dataclasses import dataclass
from pathlib import Path

import pytest

from dbx_model_catalog import CatalogModelRecord, ModelCatalogClient

CATALOG_PATH = Path(__file__).parents[3] / "js" / "web" / "catalog.json"
VERSION_PATTERN = re.compile(
    r"(?<![a-z0-9])(\d+)(?:[.\-_](\d+))?(?:[.\-_](\d+))?(?![a-z0-9])",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SearchCase:
    query: str
    expectation: str


SEARCH_MATRIX = [
    SearchCase(
        query="gpt",
        expectation="newest active GPT version, then aggregate overall rank",
    ),
    SearchCase(
        query="claude 5-6",
        expectation="closest active Claude 5.x version to 5.6, then aggregate overall rank",
    ),
    SearchCase(
        query="openai 6-1",
        expectation="active OpenAI model with version 6.1",
    ),
]


@pytest.fixture(scope="module")
def published_client() -> ModelCatalogClient:
    return ModelCatalogClient.from_json(CATALOG_PATH.read_bytes())


@pytest.mark.parametrize("case", SEARCH_MATRIX, ids=lambda case: case.query)
def test_search_matrix_matches_data_driven_expectations(
    published_client: ModelCatalogClient,
    case: SearchCase,
) -> None:
    expected = _expected_top(published_client.list(), case.query)
    ranked = published_client.search(case.query, limit=5)
    filtered = published_client.filter({"query": case.query, "limit": 5})

    assert ranked, case.expectation
    assert ranked[0].record.id == expected.id
    assert filtered[0].id == expected.id


def test_family_search_accepts_new_models_without_named_policy() -> None:
    client = ModelCatalogClient.from_catalog(
        _catalog(
            _model("databricks-gpt-6-1-sol", "OpenAI GPT-6.1 Sol", "2026-09-29"),
            _model("databricks-gpt-7", "OpenAI GPT-7", "2027-01-12"),
            _model("databricks-gpt-oss-120b", "OpenAI GPT OSS 120B", "2025-08-05"),
        )
    )

    assert client.search("gpt", limit=1)[0].record.id == "databricks-gpt-7"


def test_requested_major_version_beats_matching_minor_version() -> None:
    client = ModelCatalogClient.from_catalog(
        _catalog(
            _model("claude-opus-5-5", "Claude Opus 5.5", "2026-09-22", rank=1),
            _model("claude-opus-4-6", "Claude Opus 4.6", "2026-02-05", rank=1),
        )
    )

    assert client.search("claude 5-6", limit=1)[0].record.id == "claude-opus-5-5"


def test_fuzzy_typo_and_metadata_search() -> None:
    client = ModelCatalogClient.from_catalog(
        _catalog(
            _model(
                "claude-sonnet-5",
                "Claude Sonnet 5",
                "2026-06-30",
                tasks=["coding", "document analysis"],
            ),
            _model("gpt-6", "OpenAI GPT-6", "2026-09-22", tasks=["chat"]),
        )
    )

    assert client.search("claud sonet", limit=1)[0].record.id == "claude-sonnet-5"
    assert client.search("document analysis", limit=1)[0].record.id == "claude-sonnet-5"


def test_new_model_is_not_penalized_for_a_lagging_leaderboard() -> None:
    client = ModelCatalogClient.from_catalog(
        _catalog(
            _model(
                "databricks-gpt-6",
                "OpenAI GPT-6",
                "2026-09-22",
                rank=1,
                ranking_published_at="2026-09-30",
            ),
            _model(
                "databricks-gpt-6-1",
                "OpenAI GPT-6.1",
                "2026-10-31",
            ),
        )
    )

    ranked = client.search("gpt", limit=2)

    assert ranked[0].record.id == "databricks-gpt-6-1"
    assert ranked[0].scores.leaderboard == 50
    assert ranked[0].scores.freshness > ranked[1].scores.freshness


def test_leaderboard_and_benchmark_evidence_stay_separate() -> None:
    client = ModelCatalogClient.from_catalog(
        _catalog(
            _model(
                "databricks-gpt-6",
                "OpenAI GPT-6",
                "2026-10-31",
                rank=1,
                ranking_published_at="2025-01-01",
                benchmark_rank=1,
                benchmark_published_at="2026-11-01",
            )
        )
    )

    result = client.search("gpt", limit=1)[0]

    assert result.scores.benchmark > result.scores.leaderboard
    assert result.scores.leaderboard != result.scores.benchmark


def test_search_index_exposes_python_owned_weights() -> None:
    client = ModelCatalogClient.from_catalog(
        _catalog(_model("databricks-gpt-6", "OpenAI GPT-6", "2026-10-31"))
    )

    index = client.search_index

    assert index.weights.relevance == 0.70
    assert index.weights.leaderboard < index.weights.benchmark
    assert index.documents[0].id == "databricks-gpt-6"


def _expected_top(
    records: list[CatalogModelRecord],
    query: str,
) -> CatalogModelRecord:
    requested = _version(query)
    text = query.casefold()
    if "claude" in text:
        candidates = [record for record in records if "claude" in _identity(record)]
    elif "openai" in text:
        candidates = [record for record in records if record.publisher == "OpenAI"]
    else:
        candidates = [record for record in records if "gpt" in _identity(record)]
    candidates = [record for record in candidates if record.status.value == "active"]
    return min(
        candidates,
        key=lambda record: (
            _version_distance(_version(record.name) or _version(record.id), requested),
            _overall_rank(record),
            -(record.release_date.toordinal() if record.release_date else 0),
            record.name.casefold(),
        ),
    )


def _identity(record: CatalogModelRecord) -> str:
    return " ".join(
        [record.id, record.name, record.family or "", *record.aliases]
    ).casefold()


def _version(value: str) -> tuple[int, ...]:
    match = VERSION_PATTERN.search(value.casefold())
    return (
        tuple(int(part) for part in match.groups() if part is not None)
        if match
        else ()
    )


def _version_distance(
    candidate: tuple[int, ...],
    requested: tuple[int, ...],
) -> tuple[int, ...]:
    if not requested:
        padded = (*candidate, 0, 0, 0)[:3]
        return (0, *(-part for part in padded))
    if not candidate:
        return (1, 1, 1_000, 1_000, 1_000)
    left = (*candidate, 0, 0, 0)[:3]
    right = (*requested, 0, 0, 0)[:3]
    return (
        0,
        0 if left[0] == right[0] else 1,
        abs(left[0] - right[0]),
        abs(left[1] - right[1]),
        abs(left[2] - right[2]),
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


def _catalog(*models: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": 15,
        "updated_at": "2026-11-05T12:00:00Z",
        "models": {str(model.pop("id")): model for model in models},
    }


def _model(
    model_id: str,
    name: str,
    release_date: str,
    *,
    rank: int | None = None,
    ranking_published_at: str | None = None,
    benchmark_rank: int | None = None,
    benchmark_published_at: str | None = None,
    tasks: list[str] | None = None,
) -> dict[str, object]:
    return {
        "id": model_id,
        "name": name,
        "description": f"{name} model",
        "aliases": [],
        "type": "chat",
        "family": name.casefold().split()[1],
        "publisher": "OpenAI" if "GPT" in name else "Anthropic",
        "status": "active",
        "release_date": release_date,
        "modalities": {"input": ["text"], "output": ["text"]},
        "capabilities": {"web_search": False},
        "tasks": tasks or ["chat"],
        "use_cases": tasks or ["chat"],
        "availability": {},
        "price": {},
        "average_price": {},
        "sources": {},
        "notices": [],
        "rankings": (
            []
            if rank is None
            else [_ranking(rank, published_at=ranking_published_at)]
        ),
        "benchmarks": (
            []
            if benchmark_rank is None
            else [
                _benchmark(
                    benchmark_rank,
                    published_at=benchmark_published_at,
                )
            ]
        ),
    }


def _ranking(
    rank: int,
    *,
    published_at: str | None = None,
) -> dict[str, object]:
    return {
        "domain": "text",
        "category": "overall",
        "rank": rank,
        "sources": [],
        "metric": "rating",
        "rating": 1_500,
        "lower": 1_490,
        "upper": 1_510,
        "variance": 4,
        "votes": 1_000,
        "published_at": published_at,
    }


def _benchmark(
    rank: int,
    *,
    published_at: str | None = None,
) -> dict[str, object]:
    return {
        "name": "LiveBench",
        "rank": rank,
        "score": 90,
        "task_count": 12,
        "published_at": published_at,
        "sources": [],
    }
