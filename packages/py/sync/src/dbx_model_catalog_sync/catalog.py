from __future__ import annotations

import re
from dataclasses import dataclass, fields
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from diskcache import Cache

from dbx_model_catalog.models import ModelCatalog
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

MODEL_CATALOG_SCHEMA_VERSION = 15
LM_ARENA_LEADERBOARD_URL = "https://arena.ai/leaderboard"

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


def serialize_sources(sources: CatalogSyncSources) -> dict[str, Any]:
    return {
        _camel_case(field.name): getattr(sources, field.name).model_dump(
            mode="json", by_alias=True
        )
        for field in fields(sources)
    }


def _camel_case(value: str) -> str:
    first, *remaining = value.split("_")
    return first + "".join(part.title() for part in remaining)


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
        page_url = provider.supported_models.metadata.source_url
        for documented in provider.supported_models.models:
            model_id = documented.endpoint_name or documented.service_name or documented.section_id
            documentation_url = _url_with_fragment(page_url, documented.section_id)
            if model_id in models:
                _add_availability(
                    models[model_id], cloud, documented, documentation_url
                )
                continue
            match = _best_models_dev_match(documented, models_dev)
            model = _catalog_model(
                model_id,
                documented,
                match,
                lm_arena_results,
                live_bench_results,
                documentation_url,
            )
            _add_availability(model, cloud, documented, documentation_url)
            models[model_id] = model
    _add_pricing(models, sources.databricks.data.pricing)
    _remove_ambiguous_aliases(models)
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


def _source_link(label: str, url: str) -> dict[str, str] | None:
    normalized_url = url.strip()
    if not normalized_url.startswith(("http://", "https://")):
        return None
    return {"label": label.strip() or "Source", "url": normalized_url}


def _dedupe_sources(
    sources: list[dict[str, str] | None],
) -> list[dict[str, str]]:
    unique: dict[str, dict[str, str]] = {}
    for source in sources:
        if source:
            unique.setdefault(source["url"], source)
    return list(unique.values())


def _add_field_sources(
    mapping: dict[str, list[dict[str, str]]],
    fields: tuple[str, ...],
    sources: list[dict[str, str] | None],
) -> None:
    additions = _dedupe_sources(sources)
    if not additions:
        return
    for field in fields:
        mapping[field] = _dedupe_sources([*mapping.get(field, []), *additions])


def _models_dev_source(
    provider: ModelsDevProvider,
    model: ModelsDevModel,
) -> dict[str, str] | None:
    identity = model.canonical_model_id or f"{provider.id}/{model.id}"
    path = "/".join(
        quote(segment, safe="")
        for segment in identity.strip("/").split("/")
        if segment
    )
    return _source_link("models.dev", f"https://models.dev/models/{path}")


def _url_with_fragment(url: str, fragment: str) -> str:
    return f"{url.split('#', 1)[0]}#{quote(fragment, safe='-._~')}"


def _add_pricing(
    models: dict[str, dict[str, Any]],
    pricing: Any,
) -> None:
    unit_priority = (
        "per_million_tokens",
        "per_hour_per_50_model_units",
        "per_hour",
    )
    for model_id, model in models.items():
        scores = [
            (_pricing_match_score(model_id, model, entry), entry)
            for entry in pricing.entries
        ]
        best_score = max((score for score, _ in scores), default=0)
        if not best_score:
            continue
        matches = [entry for score, entry in scores if score == best_score]
        selected_unit = next(
            (
                unit
                for unit in unit_priority
                if any(entry.get("unit") == unit for entry in matches)
            ),
            None,
        )
        if selected_unit is None:
            continue
        cloud_prices: dict[str, dict[str, Any]] = {}
        for cloud in model["availability"]:
            cloud_matches = [
                entry
                for entry in matches
                if entry.get("unit") == selected_unit
                and cloud in entry.get("clouds", ())
            ]
            if not cloud_matches:
                continue
            dbu_rates: dict[str, float] = {}
            for entry in cloud_matches:
                dbu_rates.update(entry.get("rates", {}))
            if not dbu_rates:
                continue
            currencies: dict[str, Any] = {
                "DBU": {"unit": selected_unit, "rates": dbu_rates}
            }
            override = next(
                (
                    entry.get("usd_per_dbu", {}).get(cloud)
                    for entry in cloud_matches
                    if entry.get("usd_per_dbu", {}).get(cloud) is not None
                ),
                None,
            )
            usd_per_dbu = override or pricing.usd_per_dbu.get(cloud)
            if usd_per_dbu is not None:
                currencies["USD"] = {
                    "unit": selected_unit,
                    "rates": {
                        name: round(value * usd_per_dbu, 4)
                        for name, value in dbu_rates.items()
                    },
                }
            cloud_prices[cloud] = currencies
        model["price"] = cloud_prices
        model["average_price"] = _average_prices(cloud_prices)


def _pricing_match_score(
    model_id: str,
    model: dict[str, Any],
    entry: dict[str, Any],
) -> int:
    publisher = model.get("publisher")
    identities = {
        identity
        for value in [model_id, model.get("name"), *model.get("aliases", [])]
        if value
        for identity in _pricing_identities(str(value), publisher)
    }
    score = 0
    for name in entry.get("names", ()):
        for candidate in _pricing_identities(str(name), None):
            if candidate in identities:
                score = max(score, 3)
                continue
            for identity in identities:
                release_date = model.get("release_date")
                month_day = (
                    release_date.strftime("%m%d")
                    if hasattr(release_date, "strftime")
                    else str(release_date)[5:10].replace("-", "")
                    if release_date
                    else None
                )
                if month_day and candidate == f"{identity}-{month_day}":
                    score = max(score, 3)
                    continue
                if _pricing_token_signature(candidate) == _pricing_token_signature(
                    identity
                ):
                    score = max(score, 2)
                    continue
                if not identity.startswith(f"{candidate}-"):
                    continue
                suffix = identity.removeprefix(f"{candidate}-")
                if re.fullmatch(r"\d{4}|\d{8}", suffix):
                    score = max(score, 2)
                elif suffix == "0" and len(re.findall(r"\d+", candidate)) >= 2:
                    score = max(score, 2)
                elif not re.search(r"\d", candidate):
                    score = max(score, 1)
    return score


def _pricing_identities(value: str, publisher: str | None) -> set[str]:
    identity = normalize_model_identity(value)
    identities = {identity}
    if publisher:
        prefix = normalize_model_identity(publisher)
        if identity.startswith(f"{prefix}-"):
            identities.add(identity.removeprefix(f"{prefix}-"))
    simplified = set()
    for candidate in identities:
        candidate = re.sub(r"-(?:instruct|preview|legacy|next|en)(?=-|$)", "", candidate)
        candidate = re.sub(r"-a-\d+-b(?=-|$)", "", candidate)
        candidate = re.sub(r"(?<=-\d)-0(?=-[a-z])", "", candidate)
        candidate = re.sub(r"-{2,}", "-", candidate).strip("-")
        simplified.add(candidate)
    return identities | simplified


def _pricing_token_signature(value: str) -> tuple[str, ...]:
    return tuple(sorted(value.split("-")))


def _remove_ambiguous_aliases(models: dict[str, dict[str, Any]]) -> None:
    owners: dict[str, list[str]] = {}
    for model_id, model in models.items():
        for alias in model.get("aliases", []):
            owners.setdefault(alias.casefold(), []).append(model_id)
    ambiguous = {alias for alias, model_ids in owners.items() if len(model_ids) > 1}
    if not ambiguous:
        return
    for model in models.values():
        model["aliases"] = [
            alias for alias in model.get("aliases", []) if alias.casefold() not in ambiguous
        ]


def _average_prices(
    cloud_prices: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    averages: dict[str, dict[str, Any]] = {}
    for currency in ("DBU", "USD"):
        prices = [
            currencies[currency]
            for currencies in cloud_prices.values()
            if currency in currencies
        ]
        if not prices:
            continue
        unit = prices[0]["unit"]
        rates = {
            name: round(
                sum(price["rates"][name] for price in prices if name in price["rates"])
                / sum(name in price["rates"] for price in prices),
                6,
            )
            for name in dict.fromkeys(
                name for price in prices for name in price["rates"]
            )
        }
        averages[currency] = {"unit": unit, "rates": rates}
    return averages


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
    matches: list[tuple[int, int, ModelsDevProvider, ModelsDevModel]] = []
    for provider, model in records:
        direct_candidates = {
            normalize_model_identity(model.id),
            normalize_model_identity(model.name),
        }
        canonical_candidates = (
            {normalize_model_identity(model.canonical_model_id.split("/")[-1])}
            if model.canonical_model_id
            else set()
        )
        score = max(
            _identity_match_score(identities, direct_candidates, exact=4, partial=2),
            _identity_match_score(identities, canonical_candidates, exact=3, partial=1),
        )
        if score:
            matches.append(
                (score, _provider_priority(documented, provider), provider, model)
            )
    if not matches:
        return None
    _, _, provider, model = min(
        matches,
        key=lambda item: (
            -item[0],
            -item[1],
            item[2].id.casefold(),
            item[3].id.casefold(),
        ),
    )
    return provider, model


def _identity_match_score(
    identities: set[str],
    candidates: set[str],
    *,
    exact: int,
    partial: int,
) -> int:
    if not candidates:
        return 0
    return max(
        (
            exact
            if left == right
            else partial
            if left.endswith(right) or right.endswith(left)
            else 0
        )
        for left in identities
        for right in candidates
    )


def _provider_priority(
    documented: DatabricksSupportedModel,
    provider: ModelsDevProvider,
) -> int:
    provider_id = provider.id.casefold()
    if provider_id == "databricks":
        return 2
    publisher = _model_publisher(documented, None)
    if publisher is None:
        return 0
    if PUBLISHER_NAMESPACES.get(provider_id) == publisher:
        return 1
    return int(
        normalize_model_identity(provider.name) == normalize_model_identity(publisher)
    )


def _catalog_model(
    model_id: str,
    documented: DatabricksSupportedModel,
    match: tuple[ModelsDevProvider, ModelsDevModel] | None,
    lm_arena_results: dict[str, list[tuple[str, dict[str, Any]]]],
    live_bench_results: dict[str, list[dict[str, Any]]],
    documentation_url: str,
) -> dict[str, Any]:
    provider, source = match if match else (None, None)
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
    documentation_source = _source_link(
        "Databricks documentation", documentation_url
    )
    models_dev_source = (
        _models_dev_source(provider, source) if provider and source else None
    )
    field_sources: dict[str, list[dict[str, str]]] = {}
    _add_field_sources(field_sources, ("name",), [documentation_source])
    _add_field_sources(
        field_sources,
        ("description",),
        [documentation_source if documented.description else models_dev_source],
    )
    _add_field_sources(
        field_sources,
        ("aliases",),
        [
            documentation_source if documented.service_name else None,
            models_dev_source
            if source
            and any(
                value and value != model_id
                for value in (source.canonical_model_id, source.id)
            )
            else None,
        ],
    )
    _add_field_sources(
        field_sources,
        ("type",),
        [models_dev_source if source and source.type else None],
    )
    _add_field_sources(
        field_sources,
        ("family",),
        [
            models_dev_source
            if source and source.family
            else documentation_source
            if _model_family(documented)
            else None
        ],
    )
    _add_field_sources(
        field_sources,
        ("publisher",),
        [
            documentation_source
            if documented.publisher or _model_publisher(documented, None)
            else models_dev_source
        ],
    )
    _add_field_sources(
        field_sources,
        ("status",),
        [
            documentation_source
            if documented.deprecated or documented.status
            else models_dev_source
            if source and source.status
            else None
        ],
    )
    _add_field_sources(
        field_sources,
        ("modalities",),
        [
            documentation_source if documented.supported_inputs else None,
            models_dev_source if source else None,
        ],
    )
    _add_field_sources(
        field_sources,
        ("capabilities",),
        [
            documentation_source
            if documented.web_search or documented.reasoning
            else None,
            models_dev_source if source else None,
        ],
    )
    _add_field_sources(
        field_sources,
        ("tasks",),
        [documentation_source if documented.task_types else None],
    )
    _add_field_sources(
        field_sources,
        ("open_weights", "release_date", "last_updated", "limits"),
        [models_dev_source if source else None],
    )
    _add_field_sources(
        field_sources,
        ("knowledge_cutoff",),
        [models_dev_source if source and source.knowledge else None],
    )
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
        "sources": field_sources,
        "notices": [
            {
                "kind": notice.kind,
                "text": notice.text,
                "sources": _dedupe_sources(
                    [
                        documentation_source,
                        *(
                            _source_link(
                                link.get("label") or "Linked documentation",
                                link.get("url") or "",
                            )
                            for link in notice.links
                        ),
                    ]
                ),
            }
            for notice in documented.notices
        ],
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


def _lm_arena_ranking(
    domain: str,
    row: LMArenaRow,
) -> dict[str, Any] | None:
    if row.rank is None:
        return None
    common: dict[str, Any] = {
        "domain": domain,
        "category": row.category or "overall",
        "rank": row.rank,
        "sources": _dedupe_sources(
            [
                _source_link("LM Arena", LM_ARENA_LEADERBOARD_URL),
                _source_link("LM Arena dataset", row.source_url or ""),
            ]
        ),
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
                "sources": _dedupe_sources(
                    [_source_link("LiveBench", row.source_url or "")]
                ),
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


def _add_availability(
    model: dict[str, Any],
    cloud: str,
    documented: DatabricksSupportedModel,
    documentation_url: str,
) -> None:
    status = _status(documented.status) if documented.status else model["status"]
    model["availability"][cloud] = {
        "status": status,
        "serving_modes": ["pay_per_token"],
    }
    _add_field_sources(
        model["sources"],
        ("availability",),
        [_source_link("Databricks documentation", documentation_url)],
    )


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
