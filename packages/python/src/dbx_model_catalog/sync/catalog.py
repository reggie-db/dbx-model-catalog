from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from diskcache import Cache

from ..models import ModelCatalog
from .clients import (
    DatabricksSyncClient,
    LMArenaSyncClient,
    LiveBenchSyncClient,
    ModelParamsSyncClient,
    ModelsDevSyncClient,
    SyncClient,
    SyncClientOptions,
    sync_client_cache_path,
)
from .models import (
    DatabricksCatalogData,
    DatabricksSupportedModel,
    LMArenaCatalogData,
    LMArenaRow,
    LiveBenchCatalogData,
    LiveBenchRow,
    ModelParamsData,
    ModelsDevData,
    ModelsDevModel,
    ModelsDevProvider,
    SyncResult,
)

MODEL_CATALOG_SCHEMA_VERSION = 14

EVALUATION_SUFFIXES = {
    "auto",
    "default",
    "effort",
    "high",
    "low",
    "max",
    "medium",
    "minimal",
    "none",
    "preview",
    "thinking",
    "xhigh",
}

LIVE_BENCH_USE_CASES = {
    "Agentic Coding": ("coding", "agentic workflows"),
    "Coding": ("coding",),
    "Data Analysis": ("data analysis",),
    "IF": ("instruction following",),
    "Language": ("language understanding",),
    "Mathematics": ("mathematics",),
    "Reasoning": ("reasoning",),
}

LM_ARENA_USE_CASES = {
    "agent": ("agentic workflows", "tool use"),
    "document": ("document analysis",),
    "image_edit": ("image editing",),
    "image_to_video": ("image generation", "video generation"),
    "search": ("search",),
    "text": ("chat",),
    "text_to_image": ("image generation",),
    "text_to_video": ("video generation",),
    "video_edit": ("video editing",),
}

PUBLISHER_NAME_PREFIXES = (
    ("openai ", "OpenAI"),
    ("anthropic ", "Anthropic"),
    ("google ", "Google"),
    ("meta ", "Meta"),
    ("alibaba cloud ", "Alibaba Cloud"),
    ("xai ", "xAI"),
    ("zhipu ai ", "Zhipu AI"),
    ("moonshot ai ", "Moonshot AI"),
    ("deepseek ", "DeepSeek"),
    ("typesafe ai ", "TypeSafe AI"),
    ("openjev ", "OpenJev"),
    ("gte ", "Alibaba Cloud"),
    ("bge ", "BAAI"),
)

PUBLISHER_NAMESPACES = {
    "alibaba": "Alibaba Cloud",
    "anthropic": "Anthropic",
    "deepseek": "DeepSeek",
    "deepseek-ai": "DeepSeek",
    "google": "Google",
    "meta": "Meta",
    "meta-llama": "Meta",
    "moonshotai": "Moonshot AI",
    "openai": "OpenAI",
    "qwen": "Alibaba Cloud",
    "xai": "xAI",
    "z-ai": "Zhipu AI",
    "zhipuai": "Zhipu AI",
}


@dataclass(frozen=True)
class CatalogSyncSources:
    models_dev: SyncResult[ModelsDevData]
    model_params: SyncResult[ModelParamsData]
    lm_arena: SyncResult[LMArenaCatalogData]
    live_bench: SyncResult[LiveBenchCatalogData]
    databricks: SyncResult[DatabricksCatalogData]


class CatalogSync:
    def __init__(
        self,
        *,
        models_dev: ModelsDevSyncClient | None = None,
        model_params: ModelParamsSyncClient | None = None,
        lm_arena: LMArenaSyncClient | None = None,
        live_bench: LiveBenchSyncClient | None = None,
        databricks: DatabricksSyncClient | None = None,
        options: SyncClientOptions | None = None,
    ) -> None:
        self.options = options or SyncClientOptions()
        self.models_dev = models_dev or ModelsDevSyncClient()
        self.model_params = model_params or ModelParamsSyncClient()
        self.lm_arena = lm_arena or LMArenaSyncClient()
        self.live_bench = live_bench or LiveBenchSyncClient()
        self.databricks = databricks or DatabricksSyncClient()

    def read(self) -> ModelCatalog:
        return self.sync()

    def sync_sources(self, *, refresh: bool = False) -> CatalogSyncSources:
        if refresh:
            for client in (
                self.models_dev,
                self.model_params,
                self.lm_arena,
                self.live_bench,
                self.databricks,
            ):
                _clear_source_cache(client)
        now = datetime.now(UTC)
        return CatalogSyncSources(
            models_dev=SyncResult(source="models.dev", fetchedAt=now, data=self.models_dev.read()),
            model_params=SyncResult(source="modelparams.dev", fetchedAt=now, data=self.model_params.read()),
            lm_arena=SyncResult(source="lm-arena", fetchedAt=now, data=self.lm_arena.read()),
            live_bench=SyncResult(source="livebench", fetchedAt=now, data=self.live_bench.read()),
            databricks=SyncResult(source="databricks", fetchedAt=now, data=self.databricks.read()),
        )

    def sync(self, *, refresh: bool = False) -> ModelCatalog:
        if not self.options.cache_enabled:
            return build_model_catalog(self.sync_sources(refresh=refresh))

        with Cache(_catalog_cache_directory(self.options)) as cache:
            load_catalog = cache.memoize(
                name=f"dbx-model-catalog.schema-{MODEL_CATALOG_SCHEMA_VERSION}",
                expire=self.options.cache_ttl,
                tag="normalized-catalog",
            )(
                lambda: build_model_catalog(
                    self.sync_sources(refresh=refresh)
                ).model_dump(mode="json", by_alias=True)
            )
            if refresh:
                cache.evict("normalized-catalog", retry=True)
            return ModelCatalog.model_validate(load_catalog())


def _catalog_cache_directory(options: SyncClientOptions) -> Path:
    return sync_client_cache_path(
        options.cache_name or "catalog",
        options.cache_directory,
    ).with_suffix("")


def _clear_source_cache(client: object) -> None:
    if not isinstance(client, SyncClient) or not client.options.cache_enabled:
        return
    sync_client_cache_path(
        client.options.cache_name or type(client).__name__,
        client.options.cache_directory,
    ).unlink(missing_ok=True)


def build_model_catalog(sources: CatalogSyncSources) -> ModelCatalog:
    models_dev = _models_dev_records(sources.models_dev.data)
    lm_arena_results = _lm_arena_results(sources.lm_arena.data)
    live_bench_results = _live_bench_results(sources.live_bench.data)
    models: dict[str, dict[str, Any]] = {}
    for cloud, provider in sources.databricks.data.cloud_providers.items():
        for documented in provider.supported_models.models:
            model_id = documented.endpoint_name or documented.service_name or documented.section_id
            if model_id in models:
                _add_availability(models[model_id], cloud, documented)
                continue
            match = _best_models_dev_match(documented, models_dev)
            model = _catalog_model(
                model_id,
                documented,
                match,
                lm_arena_results,
                live_bench_results,
            )
            _add_availability(model, cloud, documented)
            models[model_id] = model
    updated_at = max(
        sources.models_dev.fetched_at,
        sources.model_params.fetched_at,
        sources.lm_arena.fetched_at,
        sources.live_bench.fetched_at,
        sources.databricks.fetched_at,
    )
    return ModelCatalog.model_validate(
        {"schema_version": MODEL_CATALOG_SCHEMA_VERSION, "updated_at": updated_at, "models": models}
    )


def normalize_model_identity(value: str) -> str:
    normalized = value.strip().lower()
    normalized = re.sub(r"^system\.ai[.-]", "", normalized)
    normalized = re.sub(r"^databricks-", "", normalized)
    normalized = re.sub(r"([a-z])(\d)", r"\1-\2", normalized)
    normalized = re.sub(r"(\d)([a-z])", r"\1-\2", normalized)
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def _models_dev_records(data: ModelsDevData) -> list[tuple[ModelsDevProvider, ModelsDevModel]]:
    return [(provider, model) for provider in data.values() for model in provider.models.values()]


def _best_models_dev_match(
    documented: DatabricksSupportedModel,
    records: list[tuple[ModelsDevProvider, ModelsDevModel]],
) -> tuple[ModelsDevProvider, ModelsDevModel] | None:
    identities = {
        normalize_model_identity(value)
        for value in (documented.name, documented.endpoint_name, documented.service_name)
        if value
    }
    matches = []
    for provider, model in records:
        candidates = {normalize_model_identity(model.id), normalize_model_identity(model.name)}
        if model.canonical_model_id:
            candidates.add(normalize_model_identity(model.canonical_model_id.split("/")[-1]))
        score = max((100 if left == right else 50 if left.endswith(right) or right.endswith(left) else 0) for left in identities for right in candidates)
        if score:
            matches.append((score, provider, model))
    if not matches:
        return None
    _, provider, model = max(matches, key=lambda item: item[0])
    return provider, model


def _catalog_model(
    model_id: str,
    documented: DatabricksSupportedModel,
    match: tuple[ModelsDevProvider, ModelsDevModel] | None,
    lm_arena_results: dict[str, list[tuple[str, dict[str, Any]]]],
    live_bench_results: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    _, source = match if match else (None, None)
    aliases = [value for value in (documented.service_name, source.canonical_model_id if source else None, source.id if source else None) if value and value != model_id]
    model_type = (source.type if source else None) or "chat"
    status = "deprecated" if documented.deprecated else _status(documented.status or (source.status if source else None))
    modalities = {
        "input": [
            _modality(value)
            for value in (
                source.modalities.input if source else documented.supported_inputs
            )
        ] or ["text"],
        "output": [
            _modality(value) for value in (source.modalities.output if source else ["text"])
        ],
    }
    capabilities: dict[str, Any] = {"web_search": documented.web_search}
    if source:
        capabilities.update(
            attachments=source.attachment,
            tools=source.tool_call,
            structured_output=source.structured_output,
        )
    if documented.reasoning or (source and source.reasoning):
        levels = documented.reasoning.levels if documented.reasoning else []
        capabilities["reasoning"] = {
            "supported": True,
            **({"effort": [_effort(value) for value in levels]} if levels else {}),
            **({"description": " ".join(filter(None, [documented.reasoning.details, documented.reasoning.parameters]))} if documented.reasoning else {}),
        }
    identities = _catalog_identities(model_id, documented, source)
    ranking_matches = _matched_rankings(identities, lm_arena_results)
    benchmark_matches = _matched_benchmarks(identities, live_bench_results)
    model: dict[str, Any] = {
        "name": documented.name,
        "description": documented.description or (source.description if source else documented.name),
        "aliases": list(dict.fromkeys(aliases)),
        "type": model_type if model_type in {"chat", "image", "video", "embedding", "reranking", "decision", "transcription", "speech", "realtime", "extraction", "audio"} else "chat",
        "family": source.family if source and source.family else _model_family(documented),
        "publisher": _model_publisher(documented, source),
        "open_weights": source.open_weights if source else None,
        "status": status,
        "release_date": source.release_date.date() if source else None,
        "last_updated": source.last_updated.date() if source else None,
        "knowledge_cutoff": source.knowledge.date() if source and source.knowledge else None,
        "modalities": modalities,
        "capabilities": capabilities,
        "limits": source.limit.model_dump(exclude_none=True) if source else None,
        "tasks": documented.task_types,
        "use_cases": _use_cases(
            documented,
            model_type,
            modalities,
            capabilities,
            ranking_matches,
            benchmark_matches,
        ),
        "availability": {},
        "price": {},
        "average_price": {},
        "notices": [{"kind": notice.kind, "text": notice.text} for notice in documented.notices],
        "rankings": [ranking for _, ranking in ranking_matches],
        "benchmarks": benchmark_matches,
    }
    return {key: value for key, value in model.items() if value is not None}


def _catalog_identities(
    model_id: str,
    documented: DatabricksSupportedModel,
    source: ModelsDevModel | None,
) -> set[str]:
    values = [model_id, documented.name, documented.endpoint_name, documented.service_name]
    if source:
        values.extend((source.id, source.name, source.canonical_model_id))
    identities = {
        identity
        for value in values
        if value
        for identity in _evaluation_identities(value.split("/")[-1])
    }
    for publisher in PUBLISHER_NAMESPACES.values():
        prefix = normalize_model_identity(publisher)
        identities.update(
            identity.removeprefix(f"{prefix}-")
            for identity in tuple(identities)
            if identity.startswith(f"{prefix}-")
        )
    return identities


def _evaluation_identities(value: str) -> set[str]:
    identity = normalize_model_identity(value)
    identities = {identity}
    parts = identity.split("-")
    while parts:
        if re.fullmatch(r"\d{8}", parts[-1]) or re.fullmatch(r"\d+k", parts[-1]):
            parts.pop()
        elif parts[-1] in EVALUATION_SUFFIXES:
            parts.pop()
        else:
            break
        if parts:
            identities.add("-".join(parts))
    return identities


def _evaluation_variant(value: str) -> dict[str, Any] | None:
    identity = normalize_model_identity(value)
    parts = set(identity.split("-"))
    variant: dict[str, Any] = {}
    effort = next(
        (value for value in ("xhigh", "max", "high", "medium", "low", "minimal", "none", "default") if value in parts),
        None,
    )
    if effort:
        variant["reasoning_effort"] = effort
    if "thinking" in parts:
        variant.update(reasoning=True, reasoning_mode="thinking")
    elif "auto" in parts:
        variant.update(reasoning=True, reasoning_mode="auto")
    context = next(
        (int(match.group(1)) * 1000 for part in parts if (match := re.fullmatch(r"(\d+)k", part))),
        None,
    )
    if context:
        variant["context"] = context
    return variant or None


def _lm_arena_results(
    data: LMArenaCatalogData,
) -> dict[str, list[tuple[str, dict[str, Any]]]]:
    latest: dict[str, dict[tuple[str, str], tuple[str, dict[str, Any]]]] = {}
    for domain, configuration in data.configurations.items():
        for row in configuration.rows:
            ranking = _lm_arena_ranking(domain, row)
            if ranking:
                for identity in _evaluation_identities(row.model_name):
                    key = (domain, ranking["category"])
                    current = latest.setdefault(identity, {}).get(key)
                    if current is None or _ranking_sort_key(ranking) > _ranking_sort_key(current[1]):
                        latest[identity][key] = (domain, ranking)
    results: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for identity, rankings in latest.items():
        by_domain: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        for domain, ranking in rankings.values():
            by_domain.setdefault(domain, []).append((domain, ranking))
        results[identity] = [
            next(
                (item for item in domain_rankings if item[1]["category"] == "overall"),
                min(domain_rankings, key=lambda item: item[1]["rank"]),
            )
            for domain_rankings in by_domain.values()
        ]
    return results


def _ranking_sort_key(ranking: dict[str, Any]) -> tuple[date, int]:
    return ranking.get("published_at", date.min), -ranking["rank"]


def _matched_rankings(
    identities: set[str],
    results: dict[str, list[tuple[str, dict[str, Any]]]],
) -> list[tuple[str, dict[str, Any]]]:
    matches: list[tuple[str, dict[str, Any]]] = []
    seen: set[tuple[str, str, int, str]] = set()
    for identity in identities:
        for domain, ranking in results.get(identity, []):
            key = (domain, ranking["category"], ranking["rank"], ranking["metric"])
            if key not in seen:
                matches.append((domain, ranking))
                seen.add(key)
    return sorted(matches, key=lambda item: item[1]["rank"])


def _lm_arena_ranking(domain: str, row: LMArenaRow) -> dict[str, Any] | None:
    if row.rank is None:
        return None
    common: dict[str, Any] = {
        "domain": domain,
        "category": row.category or "overall",
        "rank": row.rank,
    }
    if row.leaderboard_publish_date:
        common["published_at"] = row.leaderboard_publish_date.date()
    if variant := _evaluation_variant(row.model_name):
        common["variant"] = variant
    if None not in (row.rating, row.rating_lower, row.rating_upper, row.variance, row.vote_count):
        return {
            **common,
            "metric": "rating",
            "rating": row.rating,
            "lower": row.rating_lower,
            "upper": row.rating_upper,
            "variance": row.variance,
            "votes": row.vote_count,
        }
    if None not in (row.score, row.score_ci_lower, row.score_ci_upper, row.observation_count):
        return {
            **common,
            "metric": "score",
            "score": row.score,
            "lower": row.score_ci_lower,
            "upper": row.score_ci_upper,
            "observations": row.observation_count,
            "sessions": row.session_count,
        }
    return None


def _live_bench_results(data: LiveBenchCatalogData) -> dict[str, list[dict[str, Any]]]:
    category_scores: dict[str, list[tuple[LiveBenchRow, float]]] = {}
    for category, tasks in data.categories.items():
        category_scores[category] = [
            (row, sum(scores) / len(scores))
            for row in data.rows
            if (scores := [row.scores[task] for task in tasks if row.scores.get(task) is not None])
        ]

    results: dict[str, list[dict[str, Any]]] = {}
    for category, rows in category_scores.items():
        ranked = sorted(rows, key=lambda item: item[1], reverse=True)
        tasks = data.categories[category]
        for rank, (row, score) in enumerate(ranked, start=1):
            benchmark: dict[str, Any] = {
                "name": category,
                "rank": rank,
                "score": round(score, 3),
                "task_count": len(tasks),
                "published_at": data.release,
            }
            if variant := _evaluation_variant(row.model):
                benchmark["variant"] = variant
            for identity in _evaluation_identities(row.model):
                results.setdefault(identity, []).append(benchmark)
    return results


def _matched_benchmarks(
    identities: set[str],
    results: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    seen: set[tuple[str, int, float]] = set()
    for identity in identities:
        for benchmark in results.get(identity, []):
            key = (benchmark["name"], benchmark["rank"], benchmark["score"])
            if key not in seen:
                matches.append(benchmark)
                seen.add(key)
    return sorted(matches, key=lambda benchmark: benchmark["rank"])


def _use_cases(
    documented: DatabricksSupportedModel,
    model_type: str,
    modalities: dict[str, list[str]],
    capabilities: dict[str, Any],
    rankings: list[tuple[str, dict[str, Any]]],
    benchmarks: list[dict[str, Any]],
) -> list[str]:
    values = list(documented.use_cases)
    if model_type == "chat":
        values.append("chat")
    elif model_type == "embedding":
        values.extend(("embeddings", "retrieval"))
    elif model_type == "reranking":
        values.extend(("reranking", "retrieval"))
    elif model_type == "transcription":
        values.append("transcription")
    elif model_type == "speech":
        values.append("speech generation")
    if capabilities.get("reasoning"):
        values.append("reasoning")
    if capabilities.get("tools"):
        values.extend(("tool use", "agentic workflows"))
    if capabilities.get("web_search"):
        values.append("search")
    if capabilities.get("attachments") or "application/pdf" in modalities["input"]:
        values.append("document analysis")
    if "image" in modalities["input"] and "text" in modalities["output"]:
        values.append("image understanding")
    if "image" in modalities["output"]:
        values.append("image generation")
    for domain, _ in rankings:
        base_domain = next((prefix for prefix in LM_ARENA_USE_CASES if domain.startswith(prefix)), None)
        if base_domain:
            values.extend(LM_ARENA_USE_CASES[base_domain])
    for benchmark in benchmarks:
        values.extend(LIVE_BENCH_USE_CASES.get(benchmark["name"], ()))
    return list(dict.fromkeys(value.strip().lower() for value in values if value.strip()))


def _model_publisher(
    documented: DatabricksSupportedModel,
    source: ModelsDevModel | None,
) -> str | None:
    if documented.publisher:
        return documented.publisher

    name = documented.name.replace("\u200b", "").strip().casefold()
    for prefix, publisher in PUBLISHER_NAME_PREFIXES:
        if name.startswith(prefix):
            return publisher

    identities = (
        source.canonical_model_id if source else None,
        source.id if source else None,
        documented.service_name,
        documented.endpoint_name,
    )
    for identity in identities:
        if not identity or "/" not in identity:
            continue
        namespace = identity.split("/", 1)[0].casefold()
        if publisher := PUBLISHER_NAMESPACES.get(namespace):
            return publisher
    return None


def _model_family(documented: DatabricksSupportedModel) -> str | None:
    identity = normalize_model_identity(
        documented.service_name or documented.endpoint_name or documented.name
    )
    for family in ("bge", "gte", "jev"):
        if family in identity:
            return family
    return None


def _add_availability(model: dict[str, Any], cloud: str, documented: DatabricksSupportedModel) -> None:
    model["availability"][cloud] = {
        "status": _status(documented.status),
        "serving_modes": ["pay_per_token"],
    }


def _status(value: str | None) -> str:
    normalized = (value or "active").strip().lower()
    aliases = {"experimental": "preview", "public preview": "preview", "ga": "active", "generally available": "active"}
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in {"active", "preview", "alpha", "beta", "legacy", "deprecated", "retired"} else "active"


def _modality(value: str) -> str:
    normalized = value.strip().lower().rstrip("s")
    return "application/pdf" if normalized == "pdf" else normalized


def _effort(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "", value.lower())
    return "xhigh" if normalized in {"xhigh", "extrahigh"} else normalized
