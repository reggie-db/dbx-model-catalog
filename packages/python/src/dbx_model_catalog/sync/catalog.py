from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
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
    LiveBenchCatalogData,
    ModelParamsData,
    ModelsDevData,
    ModelsDevModel,
    ModelsDevProvider,
    SyncResult,
)

MODEL_CATALOG_SCHEMA_VERSION = 12

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
    models: dict[str, dict[str, Any]] = {}
    for cloud, provider in sources.databricks.data.cloud_providers.items():
        for documented in provider.supported_models.models:
            model_id = documented.endpoint_name or documented.service_name or documented.section_id
            if model_id in models:
                _add_availability(models[model_id], cloud, documented)
                continue
            match = _best_models_dev_match(documented, models_dev)
            model = _catalog_model(model_id, documented, match)
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
        "use_cases": documented.use_cases,
        "availability": {},
        "price": {},
        "average_price": {},
        "notices": [{"kind": notice.kind, "text": notice.text} for notice in documented.notices],
        "rankings": [],
        "benchmarks": [],
    }
    return {key: value for key, value in model.items() if value is not None}


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
