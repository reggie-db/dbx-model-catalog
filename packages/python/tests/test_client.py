from __future__ import annotations

import json
from typing import assert_type

import brotli
import pytest

from dbx_model_catalog import (
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
        "capabilities": {"web_search": False},
        "tasks": tasks,
        "use_cases": [],
        "availability": {},
        "price": {},
        "average_price": {},
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
        "schema_version": 12,
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

    assert client.schema_version == 12
    assert client.size == 3
    assert client.get("databricks-gpt-active").name == "GPT Active"
    assert fetched.get("databricks-llama").name == "Llama Active"


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


def test_writes_normalized_json_and_brotli_artifacts(
    catalog: dict[str, object], tmp_path
) -> None:
    parsed = ModelCatalogClient.from_catalog(catalog).catalog
    json_path, brotli_path = write_catalog_artifacts(parsed, tmp_path)

    assert ModelCatalogClient.from_json(json_path.read_bytes()).catalog == parsed
    assert ModelCatalogClient.from_brotli(brotli_path.read_bytes()).catalog == parsed


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
