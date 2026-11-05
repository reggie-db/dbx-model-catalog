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
    parse_databricks_pricing_catalog,
    parse_databricks_supported_models_page,
    parse_flexible_date,
    stringify_json,
    sync_client_cache_path,
    serialize_sources,
)
from dbx_model_catalog_sync.catalog import (
    CatalogSyncSources,
    _best_models_dev_match,
    _models_dev_records,
    _pricing_match_score,
    _remove_ambiguous_aliases,
)
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
        <h2 id="gpt-test">OpenAI GPT Test<a href="#gpt-test">​</a></h2>
        <p>Endpoint name: <code>databricks-gpt-test</code></p>
        <p>Supported inputs: Text, Images</p>
        <div class="IMPORTANT"><div><p>Important</p><p>Follow the <a href="/usage-policy">usage policy</a>.<p>Cache details.</p></p></div></div>
        <p>Availability: Pay-per-token</p>
        <p>General <a>model details</a>.</p>
        """,
        "https://example.com/models",
    )

    assert page.models[0].name == "OpenAI GPT Test"
    assert page.models[0].endpoint_name == "databricks-gpt-test"
    assert page.models[0].supported_inputs == ["Text", "Images"]
    assert page.models[0].description == "Availability: Pay-per-token. General model details."
    assert page.models[0].notices[0].model_dump() == {
        "kind": "important",
        "text": "Follow the usage policy. Cache details.",
        "links": [
            {
                "label": "usage policy",
                "url": "https://example.com/usage-policy",
            }
        ],
    }


def test_models_dev_matching_prefers_databricks_then_owning_publisher() -> None:
    documented = parse_databricks_supported_models_page(
        """
        <h1>Supported models</h1>
        <h2 id="gpt-test">OpenAI GPT Test</h2>
        <p>Endpoint name: databricks-gpt-test</p>
        """,
        "https://example.com/models",
    ).models[0]

    def model(model_id: str, canonical_model_id: str | None = None) -> dict[str, object]:
        return {
            "id": model_id,
            "name": model_id,
            "description": "Model description",
            "attachment": True,
            "reasoning": True,
            "tool_call": True,
            "release_date": "2026-10-01",
            "last_updated": "2026-10-30",
            "modalities": {"input": ["text"], "output": ["text"]},
            "open_weights": False,
            "limit": {"context": 200000, "output": 32000},
            "canonical_model_id": canonical_model_id,
        }

    data = ModelsDevSyncClient.model.validate_python(
        {
            "gateway": {
                "id": "gateway",
                "env": [],
                "npm": "@ai-sdk/openai-compatible",
                "name": "Gateway",
                "doc": "https://example.com/gateway",
                "models": {
                    "variant": model("openai/gpt-test-pro", "openai/gpt-test"),
                },
            },
            "openai": {
                "id": "openai",
                "env": [],
                "npm": "@ai-sdk/openai",
                "name": "OpenAI",
                "doc": "https://example.com/openai",
                "models": {"base": model("gpt-test")},
            },
            "databricks": {
                "id": "databricks",
                "env": [],
                "npm": "@ai-sdk/openai-compatible",
                "name": "Databricks",
                "doc": "https://example.com/databricks",
                "models": {"base": model("databricks-gpt-test")},
            },
        }
    )

    provider, matched = _best_models_dev_match(
        documented, _models_dev_records(data)
    ) or (None, None)
    assert provider is not None and provider.id == "databricks"
    assert matched is not None and matched.id == "databricks-gpt-test"

    provider, matched = _best_models_dev_match(
        documented,
        [
            record
            for record in _models_dev_records(data)
            if record[0].id != "databricks"
        ],
    ) or (None, None)
    assert provider is not None and provider.id == "openai"
    assert matched is not None and matched.id == "gpt-test"


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


def test_pricing_parser_combines_page_rates_with_cloud_sku_prices() -> None:
    foundation_url = "https://www.databricks.com/product/pricing/foundation-model-serving"
    proprietary_url = "https://www.databricks.com/product/pricing/proprietary-foundation-model-serving"
    pages = {
        foundation_url: {
            "section": {
                "__typename": "Drupal_ParagraphPricingRichtext",
                "fieldDescription": {
                    "processed": """
                    <h3>Pay Per Token</h3>
                    <table>
                      <thead><tr><th rowspan="2">Model</th><th colspan="2">Pay Per Token (DBU Per 1M Tokens)</th></tr>
                      <tr><th>Input</th><th>Output</th></tr></thead>
                      <tbody><tr><td>GLM-5.2, 5.3</td><td>20</td><td>62.857</td></tr></tbody>
                    </table>
                    """
                },
                "fieldItem": {
                    "entity": {
                        "fieldPricingClouds": ["aws", "google"],
                        "fieldPricingVendors": [],
                    }
                },
            }
        },
        proprietary_url: {
            "section": {
                "__typename": "Drupal_ParagraphPricingRichtext",
                "fieldDescription": {
                    "processed": """
                    <h3>Pay Per Token</h3>
                    <table>
                      <thead><tr><th rowspan="2">Model</th><th rowspan="2"></th><th colspan="2">Standard Pay Per Token (DBU Per 1M Tokens)</th></tr>
                      <tr><th>Input</th><th>Output</th></tr></thead>
                      <tbody>
                        <tr><td rowspan="2">GPT-6.1 Sol</td><td>Short context</td><td>28.571</td><td>142.857</td></tr>
                        <tr><td>Long context</td><td>57.143</td><td>214.286</td></tr>
                      </tbody>
                    </table>
                    """
                },
                "fieldItem": {
                    "entity": {
                        "fieldPricingClouds": [],
                        "fieldPricingVendors": ["openai"],
                    }
                },
            }
        },
    }
    cards = {
        "fmServingSku": {
            "AWS": {"GLM-5.2": {"US East": "0.07"}},
            "Azure": {"GLM-5.2": {"East US": "0.08"}},
            "GCP": {"GLM-5.2": {"US (Iowa)": "0.09"}},
        },
        "premium": {
            "AWS": {"prop_model_serving": {"OpenAI": "0.07"}},
            "Azure": {"prop_model_serving": {"OpenAI": "0.08"}},
            "GCP": {"prop_model_serving": {"OpenAI": "0.09"}},
        },
    }

    pricing = parse_databricks_pricing_catalog(pages, cards)

    assert pricing.default_regions == {
        "aws": "US East",
        "azure": "East US",
        "gcp": "US (Iowa)",
    }
    assert pricing.usd_per_dbu == {"aws": 0.07, "azure": 0.08, "gcp": 0.09}
    glm = next(entry for entry in pricing.entries if "GLM-5.3" in entry["names"])
    assert glm["clouds"] == ["aws", "gcp"]
    assert glm["rates"] == {"input": 20.0, "output": 62.857}
    gpt = next(entry for entry in pricing.entries if entry["names"] == ["GPT-6.1 Sol"])
    assert gpt["rates"] == {
        "short_context_input": 28.571,
        "short_context_output": 142.857,
        "long_context_input": 57.143,
        "long_context_output": 214.286,
    }
    assert gpt["usd_per_dbu"] == {"aws": 0.07, "azure": 0.08, "gcp": 0.09}


def test_pricing_matching_handles_equivalent_names_without_crossing_versions() -> None:
    base = {
        "aliases": [],
        "publisher": "Google",
        "release_date": None,
    }
    assert _pricing_match_score(
        "databricks-gemini-3-flash",
        {**base, "name": "Google Gemini 3 Flash"},
        {"names": ["Gemini 3.0 Flash"]},
    ) == 3
    assert _pricing_match_score(
        "databricks-qwen3-embedding-0-6b",
        {
            **base,
            "name": "Alibaba Cloud Qwen3-Embedding-0.6B",
            "publisher": "Alibaba Cloud",
        },
        {"names": ["Qwen 3 0.6B Embedding"]},
    ) == 2
    assert _pricing_match_score(
        "databricks-deepseek-v4-1-flash",
        {
            **base,
            "name": "DeepSeek V4.1 Flash",
            "publisher": "DeepSeek",
            "release_date": datetime(2026, 9, 10, tzinfo=UTC).date(),
        },
        {"names": ["DeepSeek V4.1 Flash (0910)"]},
    ) == 3
    assert _pricing_match_score(
        "databricks-kimi-k3-1-pro",
        {
            **base,
            "name": "Moonshot AI Kimi K3.1 Pro",
            "publisher": "Moonshot AI",
        },
        {"names": ["Kimi K3"]},
    ) == 0


def test_ambiguous_aliases_are_removed_from_all_models() -> None:
    models = {
        "one": {"aliases": ["shared", "one-only"]},
        "two": {"aliases": ["shared", "two-only"]},
    }

    _remove_ambiguous_aliases(models)

    assert models == {
        "one": {"aliases": ["one-only"]},
        "two": {"aliases": ["two-only"]},
    }


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
                        "reasoning_options": [
                            {
                                "type": "effort",
                                "values": ["low", "medium", "high", "extra-high"],
                            },
                            {"type": "toggle"},
                            {"type": "budget_tokens", "min": 1024, "max": 32768},
                        ],
                        "tool_call": True,
                        "structured_output": True,
                        "release_date": "2026-10-01",
                        "last_updated": "2026-10-30",
                        "family": "gpt",
                        "status": "beta",
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
        pricing=DatabricksPricingCatalog(
            defaultRegions={"aws": "US East", "azure": "East US", "gcp": "US Iowa"},
            usdPerDbu={"aws": 0.07, "azure": 0.08, "gcp": 0.09},
            entries=[
                {
                    "names": ["GPT Test"],
                    "clouds": ["aws", "azure", "gcp"],
                    "vendor": "openai",
                    "mode": "pay_per_token",
                    "unit": "per_million_tokens",
                    "rates": {"input": 2.0, "output": 6.0},
                    "usd_per_dbu": {"aws": 0.07, "azure": 0.08, "gcp": 0.09},
                    "source_url": "https://example.com/pricing",
                }
            ],
        ),
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
                                    "source_url": "https://huggingface.co/datasets/x/blob/main/agent/latest-00000-of-00001.parquet?sql_row=0",
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
                                    "source_url": "https://huggingface.co/datasets/x/blob/main/agent/latest-00000-of-00001.parquet?sql_row=1",
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
                            "source_url": "https://github.com/LiveBench/livebench.github.io/blob/main/public/table_2026_10_30.csv#L2",
                            "scores": {"code_generation": 99, "code_completion": 99},
                        },
                        {
                            "model": "gpt-test-high-effort",
                            "source_url": "https://github.com/LiveBench/livebench.github.io/blob/main/public/table_2026_10_30.csv#L3",
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
    assert model.status == "beta"
    assert model.modalities.input == ["text", "application/pdf"]
    assert model.capabilities.reasoning is not None
    assert model.capabilities.reasoning.model_dump(mode="json", exclude_none=True) == {
        "supported": True,
        "effort": ["low", "medium", "high", "xhigh"],
        "toggle": True,
        "budget": {"min": 1024, "max": 32768},
    }
    assert model.limits.context == 200000
    assert set(model.availability) == {"aws", "azure", "gcp"}
    assert {value.status for value in model.availability.values()} == {"beta"}
    assert model.price["aws"]["DBU"].rates == {"input": 2.0, "output": 6.0}
    assert model.price["azure"]["USD"].rates == {"input": 0.16, "output": 0.48}
    assert model.average_price["USD"].rates == {"input": 0.16, "output": 0.48}
    assert model.rankings[0].model_dump(mode="json", exclude_none=True) == {
        "domain": "agent",
        "category": "overall",
        "rank": 2,
        "published_at": "2026-10-31",
        "variant": {"reasoning_effort": "high"},
        "sources": [
            {
                "label": "LM Arena",
                "url": "https://arena.ai/leaderboard",
            },
            {
                "label": "LM Arena dataset",
                "url": "https://huggingface.co/datasets/x/blob/main/agent/latest-00000-of-00001.parquet?sql_row=0",
            },
        ],
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
        "sources": [
            {
                "label": "LiveBench",
                "url": "https://github.com/LiveBench/livebench.github.io/blob/main/public/table_2026_10_30.csv#L3",
            }
        ],
    }
    assert [source.url for source in model.sources["description"]] == [
        "https://models.dev/models/openai/gpt-test"
    ]
    assert "use_cases" not in model.sources
    assert "rankings" not in model.sources
    assert "benchmarks" not in model.sources
    assert "price" not in model.sources
    assert "average_price" not in model.sources
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
