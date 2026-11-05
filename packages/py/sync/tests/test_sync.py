from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from diskcache import Cache

from dbx_model_catalog_sync import (
    CatalogSync,
    LMArenaCatalogData,
    LiveBenchCatalogData,
    ModelParamsData,
    ModelsDevSyncClient,
    SyncClient,
    SyncClientOptions,
    SyncResult,
    build_model_catalog,
    normalize_model_identity,
    parse_databricks_supported_models_page,
    parse_flexible_date,
    stringify_json,
    sync_client_cache_path,
    serialize_sources,
)
from dbx_model_catalog_sync.catalog import CatalogSyncSources
from dbx_model_catalog_sync.clients import _hf_token
from dbx_model_catalog_sync.models import DatabricksCatalogData, DatabricksPricingCatalog


class StaticClient:
    def __init__(self, value: object) -> None:
        self.value = value
        self.calls = 0

    def read(self) -> object:
        self.calls += 1
        return self.value


class CachedClient(SyncClient[str]):
    calls = 0

    def read(self) -> str:
        def load() -> str:
            self.calls += 1
            return f"value-{self.calls}"

        return self.cache_get_or_set("value", load)


def test_hf_token_reads_nearest_dotenv_without_overriding_environment(
    tmp_path, monkeypatch
) -> None:
    project = tmp_path / "project"
    nested = project / "packages" / "python"
    nested.mkdir(parents=True)
    (project / ".env").write_text('HF_TOKEN="dotenv-token"\n', encoding="utf-8")
    monkeypatch.delenv("HF_TOKEN", raising=False)

    assert _hf_token(nested) == "dotenv-token"

    monkeypatch.setenv("HF_TOKEN", "environment-token")
    assert _hf_token(nested) == "environment-token"


def test_cache_coalesces_and_uses_stable_names(tmp_path) -> None:
    client = CachedClient(SyncClientOptions(cache_directory=tmp_path, cache_ttl=60))
    with ThreadPoolExecutor(max_workers=3) as pool:
        values = list(pool.map(lambda _: client.read(), range(3)))

    assert values == ["value-1"] * 3
    assert client.calls == 1
    assert sync_client_cache_path("ModelsDevSyncClient", tmp_path).name == "models-dev.json"


def test_supported_models_parser_normalizes_notices() -> None:
    page = parse_databricks_supported_models_page(
        """
        <h1>Supported models</h1>
        <h2 id="gpt-test">OpenAI GPT Test</h2>
        <p>Endpoint name: <code>databricks-gpt-test</code></p>
        <p>Supported inputs: Text, Images</p>
        <div class="IMPORTANT"><p>Important</p><p>Follow the usage policy.</p></div>
        """,
        "https://example.com/models",
    )

    assert page.models[0].endpoint_name == "databricks-gpt-test"
    assert page.models[0].supported_inputs == ["Text", "Images"]
    assert page.models[0].notices[0].model_dump() == {
        "kind": "important",
        "text": "Follow the usage policy.",
        "links": [],
    }


def test_supported_models_parser_ignores_wrappers_and_non_model_sections() -> None:
    page = parse_databricks_supported_models_page(
        """
        <h1>Supported models</h1>
        <h2 id="in-this-article">In this article</h2>
        <div><h2 id="gpt-test">OpenAI GPT Test</h2>
        <p>Endpoint name: <code>databricks-gpt-test</code></p>
        <p>Supported inputs: Text</p></div>
        """,
        "https://example.com/models",
    )

    assert [model.name for model in page.models] == ["OpenAI GPT Test"]
    assert page.models[0].endpoint_name == "databricks-gpt-test"


def test_builds_catalog_from_python_sources() -> None:
    fetched = datetime(2026, 11, 3, tzinfo=UTC)
    models_dev = ModelsDevSyncClient.model.validate_python(
        {
            "openai": {
                "id": "openai",
                "env": [],
                "npm": "@ai-sdk/openai",
                "name": "Eden AI",
                "doc": "https://example.com",
                "models": {
                    "gpt-test": {
                        "id": "gpt-test",
                        "name": "GPT Test",
                        "description": "Model description",
                        "attachment": True,
                        "reasoning": True,
                        "tool_call": True,
                        "structured_output": True,
                        "release_date": "2026-10-01",
                        "last_updated": "2026-10-30",
                        "family": "gpt",
                        "modalities": {"input": ["text", "pdf"], "output": ["text"]},
                        "open_weights": False,
                        "limit": {"context": 200000, "output": 32000},
                        "canonical_model_id": "openai/gpt-test",
                    }
                },
            }
        }
    )
    page = parse_databricks_supported_models_page(
        '<h1>Models</h1><h2 id="gpt-test">OpenAI GPT Test</h2><p>Endpoint name: databricks-gpt-test</p>',
        "https://example.com",
    )
    databricks = DatabricksCatalogData(
        pricing=DatabricksPricingCatalog(),
        cloudProviders={
            cloud: {
                "cloudProvider": cloud,
                "supportedModels": page,
                "scoreFoundationModels": {},
                "webSearch": {},
                "retiredModelsPolicy": {},
            }
            for cloud in ("aws", "azure", "gcp")
        },
    )
    sources = CatalogSyncSources(
        models_dev=SyncResult(source="models.dev", fetchedAt=fetched, data=models_dev),
        model_params=SyncResult(
            source="modelparams.dev",
            fetchedAt=fetched,
            data=ModelParamsData.model_validate(
                {"$schema": "https://example.com", "generatedAt": fetched, "count": 0, "models": []}
            ),
        ),
        lm_arena=SyncResult(
            source="lm-arena",
            fetchedAt=fetched,
            data=LMArenaCatalogData.model_validate(
                {
                    "dataset": "x",
                    "split": "latest",
                    "metadata": [],
                    "configurations": {
                        "agent": {
                            "rows": [
                                {
                                    "model_name": "GPT Test (High)",
                                    "rank": 2,
                                    "leaderboard_publish_date": "2026-10-31",
                                    "score": 0.42,
                                    "score_ci_lower": 0.4,
                                    "score_ci_upper": 0.44,
                                    "observation_count": 120,
                                    "session_count": 40,
                                    "category": "overall",
                                },
                                {
                                    "model_name": "Unrelated Model",
                                    "rank": 1,
                                    "score": 0.7,
                                    "score_ci_lower": 0.6,
                                    "score_ci_upper": 0.8,
                                    "observation_count": 50,
                                },
                            ]
                        }
                    },
                }
            ),
        ),
        live_bench=SyncResult(
            source="livebench",
            fetchedAt=fetched,
            data=LiveBenchCatalogData.model_validate(
                {
                    "dataset": "LiveBench/livebench.github.io",
                    "release": "2026-10-30",
                    "metadata": [],
                    "categories": {"Coding": ["code_generation", "code_completion"]},
                    "rows": [
                        {
                            "model": "unrelated-model",
                            "scores": {"code_generation": 99, "code_completion": 99},
                        },
                        {
                            "model": "gpt-test-high-effort",
                            "scores": {"code_generation": 80, "code_completion": 90},
                        },
                    ],
                }
            ),
        ),
        databricks=SyncResult(source="databricks", fetchedAt=fetched, data=databricks),
    )

    sync = CatalogSync(
        models_dev=StaticClient(sources.models_dev.data),  # type: ignore[arg-type]
        model_params=StaticClient(sources.model_params.data),  # type: ignore[arg-type]
        lm_arena=StaticClient(sources.lm_arena.data),  # type: ignore[arg-type]
        live_bench=StaticClient(sources.live_bench.data),  # type: ignore[arg-type]
        databricks=StaticClient(sources.databricks.data),  # type: ignore[arg-type]
    )
    raw = serialize_sources(sync.sync_sources())

    catalog = build_model_catalog(sources)
    model = catalog.models["databricks-gpt-test"]
    assert set(raw) == {
        "modelsDev",
        "modelParams",
        "lmArena",
        "liveBench",
        "databricks",
    }
    assert raw["modelsDev"]["fetchedAt"]
    assert model.aliases == ["openai/gpt-test", "gpt-test"]
    assert model.family == "gpt"
    assert model.publisher == "OpenAI"
    assert model.modalities.input == ["text", "application/pdf"]
    assert model.limits.context == 200000
    assert set(model.availability) == {"aws", "azure", "gcp"}
    assert model.rankings[0].model_dump(mode="json", exclude_none=True) == {
        "domain": "agent",
        "category": "overall",
        "rank": 2,
        "published_at": "2026-10-31",
        "variant": {"reasoning_effort": "high"},
        "metric": "score",
        "score": 0.42,
        "lower": 0.4,
        "upper": 0.44,
        "observations": 120,
        "sessions": 40,
    }
    assert model.benchmarks[0].model_dump(mode="json", exclude_none=True) == {
        "name": "Coding",
        "rank": 2,
        "score": 85.0,
        "task_count": 2,
        "published_at": "2026-10-30",
        "variant": {"reasoning_effort": "high"},
    }
    assert model.use_cases == [
        "chat",
        "reasoning",
        "tool use",
        "agentic workflows",
        "document analysis",
        "coding",
    ]


def test_catalog_sync_caches_normalized_catalog_and_refreshes(tmp_path) -> None:
    fetched = datetime(2026, 11, 3, tzinfo=UTC)
    models_dev = StaticClient(ModelsDevSyncClient.model.validate_python({}))
    model_params = StaticClient(
        ModelParamsData.model_validate(
            {
                "$schema": "https://example.com",
                "generatedAt": fetched,
                "count": 0,
                "models": [],
            }
        )
    )
    lm_arena = StaticClient(
        LMArenaCatalogData(
            dataset="x", split="latest", metadata=[], configurations={}
        )
    )
    live_bench = StaticClient(
        LiveBenchCatalogData(
            dataset="x", release="2026-11-03", metadata=[], categories={}, rows=[]
        )
    )
    databricks = StaticClient(
        DatabricksCatalogData(
            pricing=DatabricksPricingCatalog(), cloudProviders={}
        )
    )
    sync = CatalogSync(
        models_dev=models_dev,  # type: ignore[arg-type]
        model_params=model_params,  # type: ignore[arg-type]
        lm_arena=lm_arena,  # type: ignore[arg-type]
        live_bench=live_bench,  # type: ignore[arg-type]
        databricks=databricks,  # type: ignore[arg-type]
        options=SyncClientOptions(
            cache_directory=tmp_path, cache_name="catalog", cache_ttl=60
        ),
    )

    first = sync.sync()
    second = sync.sync()
    refreshed = sync.sync(refresh=True)

    assert first == second
    assert refreshed.schema_version == first.schema_version
    assert refreshed.models == first.models
    assert refreshed.updated_at >= first.updated_at
    assert models_dev.calls == 2
    assert model_params.calls == 2
    assert lm_arena.calls == 2
    assert live_bench.calls == 2
    assert databricks.calls == 2
    with Cache(tmp_path / "catalog") as cache:
        assert len(cache) == 1


def test_python_utilities() -> None:
    assert normalize_model_identity("system.ai.GPT5Mini") == "gpt-5-mini"
    assert parse_flexible_date("2023-05").isoformat() == "2023-05-01T00:00:00+00:00"
    assert stringify_json({"count": 30801, "nested": [9007199254740993]}) == '{"count":30801,"nested":[9007199254740993]}'
