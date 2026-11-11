from __future__ import annotations

import json
import sqlite3
from typing import assert_type

import brotli
import pytest

from dbx_model_catalog import (
    MODEL_CATALOG_SCHEMA_VERSION,
    PUBLISHED_CATALOG_SCHEMA_VERSION,
    PUBLISHED_CATALOG_URL,
    CatalogFilters,
    CatalogModelRecord,
    CatalogQueryOptions,
    ModelCatalogClient,
    SerializableCatalogQuery,
    parse_catalog_query,
    serialize_catalog_query,
)
from dbx_model_catalog.publishing import write_catalog_artifacts


def model(name: str, status: str, tasks: list[str]) -> dict[str, object]:
    return {
        "name": name,
        "description": f"{name} model",
        "aliases": [],
        "type": "chat",
        "status": status,
        "modalities": {"input": ["text"], "output": ["text"]},
        "capabilities": {"responses": False, "apply_patch": False, "web_search": False},
        "tasks": tasks,
        "use_cases": [],
        "availability": {},
        "price": {},
        "average_price": {},
        "sources": {},
        "notices": [],
        "rankings": [],
        "benchmarks": [],
    }


@pytest.fixture
def catalog() -> dict[str, object]:
    active = model("GPT Active", "active", ["reasoning"])
    active.update(
        {
            "capabilities": {
                "responses": False,
                "apply_patch": False,
                "web_search": False,
                "reasoning": {"supported": True, "effort": ["high"]},
            },
            "limits": {"context": 128_000},
            "retirement": {
                "schedules": [
                    {
                        "offering": "pay_per_token",
                        "dates": ["2027-01-01", "2027-06-01"],
                    }
                ]
            },
            "rankings": [
                {
                    "domain": "text",
                    "category": "overall",
                    "rank": 2,
                    "published_at": "2026-10-30",
                    "sources": [],
                    "metric": "rating",
                    "rating": 1_250,
                    "lower": 1_200,
                    "upper": 1_300,
                    "variance": 25,
                    "votes": 500,
                },
                {
                    "domain": "text",
                    "category": "coding",
                    "rank": 1,
                    "published_at": "2026-10-30",
                    "sources": [],
                    "metric": "score",
                    "score": 0.95,
                    "lower": 0.9,
                    "upper": 1,
                    "observations": 100,
                    "sessions": 20,
                },
            ],
        }
    )
    llama = model("Llama Active", "active", ["chat"])
    llama["limits"] = {"context": 8_192}
    return {
        "schema_version": 16,
        "updated_at": "2026-10-31T12:00:00.000Z",
        "models": {
            "databricks-gpt-active": active,
            "databricks-gpt-preview": model(
                "GPT Preview", "preview", ["reasoning"]
            ),
            "databricks-llama": llama,
        },
    }


def test_reads_brotli_and_injected_fetch(catalog: dict[str, object]) -> None:
    payload = brotli.compress(json.dumps(catalog).encode())
    client = ModelCatalogClient.from_brotli(payload)
    fetched = ModelCatalogClient.from_url(
        "https://example.com/catalog.json.br", fetch=lambda _: payload
    )

    assert client.schema_version == 16
    assert client.size == 3
    assert client.get("databricks-gpt-active").name == "GPT Active"
    assert fetched.get("databricks-llama").name == "Llama Active"


def test_published_catalog_url_targets_compatible_schema() -> None:
    assert PUBLISHED_CATALOG_SCHEMA_VERSION == MODEL_CATALOG_SCHEMA_VERSION == 16
    assert PUBLISHED_CATALOG_URL.endswith("/catalog/v16/catalog.json")


def test_accepts_injected_decoder(catalog: dict[str, object]) -> None:
    client = ModelCatalogClient.from_brotli(
        b"not-brotli", decode=lambda _payload, _encoding: json.dumps(catalog)
    )
    assert client.size == 3


def test_published_client_uses_persistent_cache_and_refreshes(
    catalog: dict[str, object], tmp_path
) -> None:
    payload = brotli.compress(json.dumps(catalog).encode())
    calls = 0

    def fetch(_url: str) -> bytes:
        nonlocal calls
        calls += 1
        return payload

    first = ModelCatalogClient.from_published(
        url="https://example.com/catalog.json.br",
        cache_directory=tmp_path,
        fetch=fetch,
    )
    second = ModelCatalogClient.from_published(
        url="https://example.com/catalog.json.br",
        cache_directory=tmp_path,
        fetch=fetch,
    )
    refreshed = ModelCatalogClient.from_published(
        refresh=True,
        url="https://example.com/catalog.json.br",
        cache_directory=tmp_path,
        fetch=fetch,
    )

    assert first.size == second.size == refreshed.size == 3
    assert calls == 2


def test_writes_normalized_catalog_artifact(
    catalog: dict[str, object], tmp_path
) -> None:
    parsed = ModelCatalogClient.from_catalog(catalog).catalog
    json_path = write_catalog_artifacts(parsed, tmp_path)

    assert ModelCatalogClient.from_json(json_path.read_bytes()).catalog == parsed
    version_directory = tmp_path / "catalog" / f"v{parsed.schema_version}"
    assert ModelCatalogClient.from_json(
        (version_directory / "catalog.json").read_bytes()
    ).catalog == parsed
    search_index = json.loads((tmp_path / "search-index.json").read_text())
    assert search_index["catalog_schema_version"] == parsed.schema_version
    assert len(search_index["documents"]) == len(parsed.models)
    with sqlite3.connect(tmp_path / "catalog.sqlite") as database:
        assert database.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        metadata = dict(database.execute("SELECT key, value FROM metadata"))
        assert metadata["catalog_schema_version"] == str(parsed.schema_version)
        assert metadata["model_count"] == str(len(parsed.models))
        assert database.execute("SELECT count(*) FROM models").fetchone() == (
            len(parsed.models),
        )
        search_results = database.execute(
            "SELECT model_id FROM model_search WHERE model_search MATCH 'reasoning'"
        ).fetchall()
        assert search_results
    version_index = json.loads((tmp_path / "catalog" / "index.json").read_text())
    assert version_index == {
        "latest_schema_version": parsed.schema_version,
        "updated_at": "2026-10-31T12:00:00Z",
        "versions": [
            {
                "schema_version": parsed.schema_version,
                "updated_at": "2026-10-31T12:00:00Z",
                "catalog": f"v{parsed.schema_version}/catalog.json",
                "search_index": f"v{parsed.schema_version}/search-index.json",
                "database": f"v{parsed.schema_version}/catalog.sqlite",
            }
        ],
    }


def test_preserves_previous_schema_lanes(
    catalog: dict[str, object], tmp_path
) -> None:
    previous = tmp_path / "catalog" / "v14"
    previous.mkdir(parents=True)
    (previous / "catalog.json").write_text(
        '{"schema_version":14,"updated_at":"2026-01-01T00:00:00Z","models":{}}\n'
    )
    (previous / "search-index.json").write_text("{}\n")
    (previous / "catalog.sqlite").write_bytes(b"previous schema database")

    parsed = ModelCatalogClient.from_catalog(catalog).catalog
    write_catalog_artifacts(parsed, tmp_path)

    version_index = json.loads((tmp_path / "catalog" / "index.json").read_text())
    assert [version["schema_version"] for version in version_index["versions"]] == [
        14,
        16,
    ]
    assert (previous / "catalog.json").is_file()


def test_queries_boolean_text_sort_and_limit(catalog: dict[str, object]) -> None:
    client = ModelCatalogClient.from_catalog(catalog)
    results = client.query(
        {
            "$and": [
                {"status": {"$eq": "active"}},
                {"tasks": {"$contains": "reasoning"}},
                {"name": {"$contains": "gpt"}},
                {"$not": {"name": {"$contains": "preview"}}},
            ]
        },
        CatalogQueryOptions(
            order_by={"field": "name", "direction": "desc"}, limit=1
        ),
    )

    assert_type(results, list[CatalogModelRecord])
    assert [record.id for record in results] == ["databricks-gpt-active"]


def test_queries_nested_arrays_and_returns_complete_records(
    catalog: dict[str, object],
) -> None:
    client = ModelCatalogClient.from_catalog(catalog)
    results = client.query(
        {
            "$and": [
                {"status": ["preview", "active"]},
                {"tasks": ["missing", "reasoning"]},
                {
                    "capabilities": {
                        "reasoning": {"effort": ["medium", "high"]}
                    }
                },
                {
                    "rankings": [
                        {"metric": "score", "rank": {"$lte": 0}},
                        {"metric": "rating", "rank": {"$lte": 10}},
                    ]
                },
                {
                    "retirement": {
                        "schedules": {
                            "dates": ["2026-01-01", "2027-06-01"]
                        }
                    }
                },
            ]
        }
    )

    assert [record.id for record in results] == ["databricks-gpt-active"]
    assert results[0].description == "GPT Active model"
    assert results[0].limits.context == 128_000
    assert results[0].rankings[0].rank == 2


def test_typed_callback(catalog: dict[str, object]) -> None:
    client = ModelCatalogClient.from_catalog(catalog)
    results = client.query(
        lambda record: record.status.value == "active"
        and record.capabilities.reasoning is not None
        and record.capabilities.reasoning.supported is True
    )
    assert [record.id for record in results] == ["databricks-gpt-active"]


def test_returns_a_standard_typed_list(catalog: dict[str, object]) -> None:
    client = ModelCatalogClient.from_catalog(catalog)
    models = client.list()
    results = [model for model in models if model.status.value == "active"]
    results.sort(key=lambda model: model.name.casefold(), reverse=True)

    assert_type(models, list[CatalogModelRecord])
    assert isinstance(models, list)
    assert [record.id for record in results] == [
        "databricks-llama",
        "databricks-gpt-active",
    ]
    assert len(models) == 3


def test_validates_and_applies_catalog_filters(
    catalog: dict[str, object],
) -> None:
    client = ModelCatalogClient.from_catalog(catalog)

    assert CatalogFilters(query="   ").query is None
    results = client.filter(
        CatalogFilters(query="  gpt  ", status=["active"], limit=1)
    )

    assert [record.id for record in results] == ["databricks-gpt-active"]
    with pytest.raises(ValueError, match="Extra inputs are not permitted"):
        CatalogFilters.model_validate({"unknown": True})


def test_serializes_parses_and_executes(catalog: dict[str, object]) -> None:
    client = ModelCatalogClient.from_catalog(catalog)
    query = SerializableCatalogQuery(
        expression={
            "$and": [
                {"status": {"$eq": "active"}},
                {"rankings": {"metric": "rating", "rank": {"$lte": 10}}},
            ]
        },
        options=CatalogQueryOptions(
            order_by={"field": "name", "direction": "asc"}, limit=10
        ),
    )

    encoded = serialize_catalog_query(query)
    parsed = parse_catalog_query(encoded)
    results = client.query(parsed.expression, parsed.options)

    assert json.loads(encoded)["options"]["orderBy"]["field"] == "name"
    assert [record.id for record in results] == ["databricks-gpt-active"]


def test_rejects_unknown_query_fields_operators_and_sort_paths() -> None:
    with pytest.raises(ValueError, match="Unknown catalog field"):
        parse_catalog_query({"expression": {"unknown": {"$eq": True}}})
    with pytest.raises(ValueError, match="Unknown filter operator"):
        parse_catalog_query(
            {"expression": {"status": {"$unknown": "active"}}}
        )
    with pytest.raises(ValueError, match="Unknown catalog sort field"):
        parse_catalog_query(
            {"expression": {}, "options": {"orderBy": "unknown"}}
        )
