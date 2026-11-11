from __future__ import annotations

import csv
import json
import os
import re
import tempfile
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from statistics import median
from typing import Any, Generic, TypeVar
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup, Tag
from pydantic import BaseModel, TypeAdapter

from .models import (
    DatabricksCatalogData,
    DatabricksCloudProviderData,
    DatabricksNotice,
    DatabricksPricingCatalog,
    DatabricksSupportedModel,
    DatabricksSupportedModelsPage,
    LMArenaCatalogData,
    LMArenaConfiguration,
    LMArenaRow,
    LiveBenchCatalogData,
    LiveBenchRow,
    ModelParamsData,
    ModelsDevData,
)

T = TypeVar("T")
Fetcher = Callable[[str, Mapping[str, str]], bytes]

MODELS_DEV_URL = "https://models.dev/api.json"
MODEL_PARAMS_URL = "https://modelparams.dev/api/v1/models.json"
LIVEBENCH_REPOSITORY = "LiveBench/livebench.github.io"
LIVEBENCH_DATASET = LIVEBENCH_REPOSITORY
LIVEBENCH_BRANCH = "main"
LM_ARENA_DATASET = "lmarena-ai/leaderboard-dataset"
DATABRICKS_CLOUD_PROVIDERS = ("aws", "azure", "gcp")
DATABRICKS_CLOUD_PROVIDER_DOCS_URLS = {
    "aws": "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/supported-models",
    "azure": "https://learn.microsoft.com/azure/databricks/machine-learning/foundation-model-apis/supported-models",
    "gcp": "https://docs.databricks.com/gcp/en/machine-learning/foundation-model-apis/supported-models",
}
DATABRICKS_PRICING_PAGE_DATA_URLS = {
    "https://www.databricks.com/product/pricing/foundation-model-serving": "https://www.databricks.com/en-pricing-assets/page-data/product/pricing/foundation-model-serving/page-data.json",
    "https://www.databricks.com/product/pricing/proprietary-foundation-model-serving": "https://www.databricks.com/en-pricing-assets/page-data/product/pricing/proprietary-foundation-model-serving/page-data.json",
}
DATABRICKS_PRICING_CARDS_URL = (
    "https://www.databricks.com/en-pricing-assets/data/pricing/cards.json"
)
DATABRICKS_RESPONSES_URL = (
    "https://docs.databricks.com/aws/en/machine-learning/model-serving/query-openai-responses"
)
DATABRICKS_WEB_SEARCH_URL = (
    "https://docs.databricks.com/aws/en/machine-learning/model-serving/web-search"
)
DATABRICKS_RATE_LIMITS_URL = (
    "https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits"
)
DATABRICKS_RETIRED_MODELS_URL = (
    "https://docs.databricks.com/aws/en/machine-learning/retired-models-policy"
)
MODEL_LATENCY_BENCHMARK_URL = (
    "https://raw.githubusercontent.com/vicaroai/tokens-per-second/main/benchmarks/results/latest.json"
)
_PRICING_CLOUD_NAMES = {"AWS": "aws", "Azure": "azure", "GCP": "gcp"}


@dataclass(frozen=True)
class SyncClientOptions:
    cache_directory: Path = Path(tempfile.gettempdir()) / "dbx-model-catalog"
    cache_enabled: bool = True
    cache_name: str | None = None
    cache_ttl: float = 3600


def sync_client_cache_path(client_name: str, directory: str | Path | None = None) -> Path:
    value = re.sub(r"(?<!^)(?=[A-Z])", "-", client_name.removesuffix("SyncClient"))
    name = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower() or "sync"
    return Path(directory or SyncClientOptions.cache_directory) / f"{name}.json"


class SyncClient(Generic[T]):
    model: type[BaseModel] | TypeAdapter[Any]
    _locks: dict[Path, threading.Lock] = {}

    def __init__(self, options: SyncClientOptions | None = None) -> None:
        self.options = options or SyncClientOptions()

    def read(self) -> T:
        raise NotImplementedError

    def parse(self, value: object) -> T:
        validator = self.model
        if isinstance(validator, TypeAdapter):
            return validator.validate_python(value)
        return validator.model_validate(value)  # type: ignore[return-value]

    def cache_get_or_set(self, key: str, loader: Callable[[], T]) -> T:
        if not self.options.cache_enabled:
            return loader()
        path = sync_client_cache_path(
            self.options.cache_name or type(self).__name__, self.options.cache_directory
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.with_suffix(path.suffix + ".lock").touch(exist_ok=True)
        lock = self._locks.setdefault(path, threading.Lock())
        with lock:
            cache = _read_cache(path)
            item = cache.get(key)
            if item and time.time() - item["stored_at"] < self.options.cache_ttl:
                return item["value"]  # type: ignore[return-value]
            value = loader()
            cache[key] = {"stored_at": time.time(), "value": value}
            path.write_text(json.dumps(cache, default=_json_default), encoding="utf-8")
            return value


class JsonSyncClient(SyncClient[T]):
    url: str

    def __init__(self, fetcher: Fetcher | None = None, options: SyncClientOptions | None = None) -> None:
        super().__init__(options)
        self.fetcher = fetcher or fetch_url

    def read(self) -> T:
        value = self.cache_get_or_set(
            self.url,
            lambda: json.loads(self.fetcher(self.url, {"accept": "application/json"})),
        )
        return self.parse(value)


class ModelsDevSyncClient(JsonSyncClient[ModelsDevData]):
    model = TypeAdapter(ModelsDevData)
    url = MODELS_DEV_URL


class ModelParamsSyncClient(JsonSyncClient[ModelParamsData]):
    model = ModelParamsData
    url = MODEL_PARAMS_URL


class LMArenaSyncClient(SyncClient[LMArenaCatalogData]):
    model = LMArenaCatalogData

    def read(self) -> LMArenaCatalogData:
        try:
            import pyarrow.parquet as parquet
            from huggingface_hub import HfApi, hf_hub_download
        except ImportError as error:
            raise RuntimeError(
                "LMArena sync requires dbx-model-catalog[sync]"
            ) from error

        token = _hf_token()
        files = [
            path
            for path in HfApi(token=token).list_repo_files(
                LM_ARENA_DATASET, repo_type="dataset"
            )
            if path.endswith(".parquet") and Path(path).name.startswith("latest-")
        ]
        configurations: dict[str, LMArenaConfiguration] = {}
        metadata: list[dict[str, Any]] = []
        for path in files:
            configuration = path.split("/")[0] if "/" in path else Path(path).stem
            local = hf_hub_download(
                repo_id=LM_ARENA_DATASET,
                filename=path,
                repo_type="dataset",
                token=token,
            )
            schema = parquet.read_schema(local)
            columns = [name for name in LMArenaRow.model_fields if name in schema.names]
            table = parquet.read_table(local, columns=columns)
            rows = [
                LMArenaRow.model_validate(
                    {
                        **row,
                        "sourceUrl": (
                            f"https://huggingface.co/datasets/{LM_ARENA_DATASET}/blob/main/"
                            f"{quote(path, safe='/')}?sql_row={row_index}"
                        ),
                    }
                )
                for row_index, row in enumerate(table.to_pylist())
                if row.get("rank") not in (None, "")
            ]
            configurations.setdefault(
                configuration, LMArenaConfiguration(rows=[])
            ).rows.extend(rows)
            metadata.append({"configuration": configuration, "path": path})
        return LMArenaCatalogData(
            dataset=LM_ARENA_DATASET,
            split="latest",
            metadata=metadata,
            configurations=configurations,
        )


class LiveBenchSyncClient(SyncClient[LiveBenchCatalogData]):
    model = LiveBenchCatalogData

    def __init__(self, fetcher: Fetcher | None = None, options: SyncClientOptions | None = None) -> None:
        super().__init__(options)
        self.fetcher = fetcher or fetch_url

    def read(self) -> LiveBenchCatalogData:
        base = f"https://raw.githubusercontent.com/{LIVEBENCH_REPOSITORY}/{LIVEBENCH_BRANCH}/public"
        metadata_url = f"https://api.github.com/repos/{LIVEBENCH_REPOSITORY}/contents/public?ref={LIVEBENCH_BRANCH}"
        metadata = self.cache_get_or_set(
            metadata_url,
            lambda: json.loads(self.fetcher(metadata_url, {"accept": "application/vnd.github+json"})),
        )
        releases: dict[str, dict[str, str]] = {}
        for file in metadata:
            match = re.fullmatch(r"(table|categories)_(\d{4}[-_]\d{2}[-_]\d{2})\.(csv|json)", file["name"])
            if match:
                releases.setdefault(match[2].replace("_", "-"), {})[match[1]] = file["name"]
        complete = sorted(date for date, files in releases.items() if {"table", "categories"} <= files.keys())
        if not complete:
            raise ValueError("LiveBench repository contained no complete leaderboard release")
        release = complete[-1]
        files = releases[release]
        categories = json.loads(self.fetcher(f"{base}/{files['categories']}", {"accept": "application/json"}))
        table = self.fetcher(f"{base}/{files['table']}", {"accept": "text/csv"}).decode()
        rows = []
        table_url = (
            f"https://github.com/{LIVEBENCH_REPOSITORY}/blob/"
            f"{LIVEBENCH_BRANCH}/public/{files['table']}"
        )
        for line_number, record in enumerate(
            csv.DictReader(table.splitlines()), start=2
        ):
            model = (record.pop("model", None) or "").strip()
            if not model:
                raise ValueError("LiveBench leaderboard row is missing its model")
            scores = {name: None if not value.strip() else float(value) for name, value in record.items()}
            rows.append(
                LiveBenchRow(
                    model=model,
                    sourceUrl=f"{table_url}#L{line_number}",
                    scores=scores,
                )
            )
        return self.parse(
            {
                "dataset": LIVEBENCH_DATASET,
                "release": release,
                "sourceUrl": table_url,
                "metadata": metadata,
                "categories": categories,
                "rows": rows,
            }
        )


class DatabricksSyncClient(SyncClient[DatabricksCatalogData]):
    model = DatabricksCatalogData

    def __init__(self, fetcher: Fetcher | None = None, options: SyncClientOptions | None = None) -> None:
        super().__init__(options)
        self.fetcher = fetcher or fetch_url

    def read(self) -> DatabricksCatalogData:
        providers: dict[str, DatabricksCloudProviderData] = {}
        for cloud, url in DATABRICKS_CLOUD_PROVIDER_DOCS_URLS.items():
            html = self.fetcher(url, {"accept": "text/html"}).decode()
            page = parse_databricks_supported_models_page(html, url)
            providers[cloud] = DatabricksCloudProviderData(
                cloudProvider=cloud,
                supportedModels=page,
                scoreFoundationModels={},
                webSearch={},
                retiredModelsPolicy={},
            )
        page_data = {
            source_url: json.loads(
                self.fetcher(url, {"accept": "application/json"})
            )
            for source_url, url in DATABRICKS_PRICING_PAGE_DATA_URLS.items()
        }
        cards = json.loads(
            self.fetcher(DATABRICKS_PRICING_CARDS_URL, {"accept": "application/json"})
        )
        responses_html = self.fetcher(
            DATABRICKS_RESPONSES_URL, {"accept": "text/html"}
        ).decode()
        web_search_html = self.fetcher(
            DATABRICKS_WEB_SEARCH_URL, {"accept": "text/html"}
        ).decode()
        rate_limits_html = self.fetcher(
            DATABRICKS_RATE_LIMITS_URL, {"accept": "text/html"}
        ).decode()
        retired_models_html = self.fetcher(
            DATABRICKS_RETIRED_MODELS_URL, {"accept": "text/html"}
        ).decode()
        latency_payload = json.loads(
            self.fetcher(MODEL_LATENCY_BENCHMARK_URL, {"accept": "application/json"})
        )
        return DatabricksCatalogData(
            pricing=parse_databricks_pricing_catalog(page_data, cards),
            cloudProviders=providers,
            capabilities=parse_databricks_capabilities(
                responses_html, web_search_html
            ),
            rateLimits=parse_databricks_rate_limits(rate_limits_html),
            retiredModels=parse_databricks_retired_models(retired_models_html),
            latency=parse_model_latency_benchmark(latency_payload),
        )


def parse_databricks_supported_models_page(html: str, source_url: str) -> DatabricksSupportedModelsPage:
    soup = BeautifulSoup(html, "html.parser")
    canonical = soup.select_one('link[rel="canonical"]')
    page_url = canonical.get("href") if canonical else source_url
    title = _text(soup.find("h1")) or "Supported models"
    description = soup.select_one('meta[name="description"]')
    modified = soup.select_one('meta[property="article:modified_time"]')
    models: list[DatabricksSupportedModel] = []
    introduction: list[str] = []
    current: Tag | None = None
    for element in soup.find_all(["h2", "p", "div"]):
        if element.name == "h2":
            current = element
            if (element.get("id") or "") == "additional-resources":
                current = None
            elif current:
                models.append(DatabricksSupportedModel(sectionId=element.get("id") or _slug(_text(element)), name=_text(element)))
            continue
        if element.name == "div" and _notice_kind(element):
            if models:
                notice = _parse_notice(element, page_url)
                if notice:
                    models[-1].notices.append(DatabricksNotice.model_validate(notice))
            continue
        if element.name == "div":
            continue
        if element.find_parent("p") is not None:
            continue
        if any(_notice_kind(parent) for parent in element.find_parents("div")):
            continue
        text = _text(element)
        if not text:
            continue
        if not models or current is None:
            introduction.append(text)
            continue
        model = models[-1]
        key, separator, value = text.partition(":")
        if separator:
            normalized = key.casefold()
            if "model service name" in normalized:
                model.service_name = value.strip()
            elif "endpoint name" in normalized:
                model.endpoint_name = value.strip()
            elif "supported inputs" in normalized:
                model.supported_inputs = [item.strip() for item in value.split(",") if item.strip()]
            elif "publisher" in normalized:
                model.publisher = value.strip()
            elif "status" in normalized:
                model.status = value.strip()
            else:
                model.paragraphs.append(text)
        else:
            model.paragraphs.append(text)
    for model in models:
        model.description = _join_paragraphs(model.paragraphs)
    models = [model for model in models if model.endpoint_name or model.service_name]
    return DatabricksSupportedModelsPage(
        metadata={
            "sourceUrl": page_url,
            "title": title,
            "description": description.get("content") if description else None,
            "modifiedAt": modified.get("content") if modified else None,
        },
        introduction=introduction,
        models=models,
        additionalResources=[],
    )


def parse_databricks_capabilities(
    responses_html: str, web_search_html: str
) -> dict[str, list[str]]:
    responses_soup = BeautifulSoup(responses_html, "html.parser")
    response_models = _section_code_values(
        responses_soup, "databricks-hosted-foundation-models"
    )
    if not response_models:
        raise ValueError("Databricks documentation contained no Responses models")
    input_text = " ".join(
        _text(element)
        for element in _section_elements(responses_soup, "supported-input-types")
    ).casefold()
    limitations = {
        _text(code)
        for element in _section_elements(responses_soup, "limitations")
        for code in element.find_all("code")
    }
    web_search_soup = BeautifulSoup(web_search_html, "html.parser")
    web_search_models = _section_code_values(web_search_soup, "supported-models")
    if not web_search_models:
        raise ValueError("Databricks documentation contained no native web-search models")
    return {
        "responses": response_models,
        "image_input": response_models if {"text", "image"} <= set(re.findall(r"[a-z]+", input_text)) else [],
        "apply_patch": response_models if "apply_patch" in limitations else [],
        "web_search": web_search_models,
    }


def parse_databricks_rate_limits(html: str) -> dict[str, dict[str, int | None]]:
    result: dict[str, dict[str, int | None]] = {}
    for rows in _html_tables(html):
        if not rows:
            continue
        headers = [value.casefold() for value in rows[0]]
        if not headers or not any("itpm" in value for value in headers):
            continue
        if not any("otpm" in value for value in headers):
            continue
        input_index = next(i for i, value in enumerate(headers) if "itpm" in value)
        output_index = next(i for i, value in enumerate(headers) if "otpm" in value)
        queries_index = next(
            (i for i, value in enumerate(headers) if "rph" in value or "qph" in value),
            None,
        )
        for row in rows[1:]:
            if not row:
                continue
            key = _public_model_key(row[0])
            if not key:
                continue
            result[key] = {
                "input_tokens_per_minute": _documented_integer(row[input_index] if input_index < len(row) else ""),
                "output_tokens_per_minute": _documented_integer(row[output_index] if output_index < len(row) else ""),
                "queries_per_hour": _documented_integer(row[queries_index] if queries_index is not None and queries_index < len(row) else ""),
            }
    if not result:
        raise ValueError("Databricks documentation contained no model rate limits")
    return result


def parse_databricks_retired_models(html: str) -> list[dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for rows in _html_tables(html):
        if not rows:
            continue
        headers = [value.casefold() for value in rows[0]]
        if not headers or headers[0] not in {"open model", "partner model"}:
            continue
        for row in rows[1:]:
            if len(row) < 2:
                continue
            replacement = row[2].strip() if len(row) > 2 else None
            schedules = _retirement_schedules(row[1])
            for name in (part.strip() for part in row[0].split("/")):
                if not name:
                    continue
                key = _public_model_key(name)
                if key:
                    result[key] = {
                        "name": name,
                        "schedules": schedules,
                        "replacement_name": replacement or None,
                    }
    if not result:
        raise ValueError("Databricks documentation contained no retired models")
    return list(result.values())


def parse_model_latency_benchmark(payload: object) -> dict[str, dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("Latency benchmark payload must be an object")
    generated_at = payload.get("generated_at")
    completion_tokens = payload.get("max_tokens")
    results = payload.get("results")
    if not isinstance(generated_at, str) or not isinstance(completion_tokens, int) or not isinstance(results, list):
        raise ValueError("Latency benchmark payload is missing required fields")
    groups: dict[str, dict[str, Any]] = {}
    for row in results:
        if not isinstance(row, dict) or row.get("ok") is not True:
            continue
        model = row.get("model")
        throughput = row.get("tokens_per_second")
        ttft = row.get("ttft_millis")
        runs = row.get("successful_runs")
        if not isinstance(model, str) or not isinstance(throughput, (int, float)) or throughput <= 0:
            continue
        if not isinstance(ttft, (int, float)) or not isinstance(runs, int) or runs <= 0:
            continue
        key = _public_model_key(model.rsplit("/", 1)[-1])
        if not key:
            continue
        group = groups.setdefault(key, {"ttft": [], "throughput": [], "response": [], "runs": 0})
        group["ttft"].append(float(ttft))
        group["throughput"].append(float(throughput))
        group["response"].append(float(ttft) + completion_tokens / float(throughput) * 1000)
        group["runs"] += runs
    models = {
        key: {
            "score": round(median(group["response"])),
            "measurements": {
                "time_to_first_token_ms": round(median(group["ttft"]), 3),
                "output_tokens_per_second": round(median(group["throughput"]), 3),
                "successful_run_count": group["runs"],
                "completion_token_count": completion_tokens,
                "measured_at": generated_at,
            },
        }
        for key, group in groups.items()
    }
    if not models:
        raise ValueError("Latency benchmark contained no successful model runs")
    return models


def parse_databricks_pricing_catalog(
    pages: Mapping[str, object],
    cards: Mapping[str, Any],
) -> DatabricksPricingCatalog:
    entries: dict[
        tuple[tuple[str, ...], tuple[str, ...], str | None, str, str],
        dict[str, Any],
    ] = {}
    for source_url, page in pages.items():
        for section in _pricing_sections(page):
            processed = section.get("fieldDescription", {}).get("processed")
            if not isinstance(processed, str):
                continue
            rule = section.get("fieldItem", {}).get("entity") or {}
            clouds = tuple(
                _pricing_cloud(value)
                for value in rule.get("fieldPricingClouds") or DATABRICKS_CLOUD_PROVIDERS
            )
            vendor_values = rule.get("fieldPricingVendors") or []
            vendor = str(vendor_values[0]).casefold() if vendor_values else None
            for entry in _parse_pricing_tables(
                processed,
                clouds=tuple(value for value in clouds if value),
                vendor=vendor,
                source_url=source_url,
            ):
                key = (
                    tuple(entry["names"]),
                    tuple(entry["clouds"]),
                    entry.get("vendor"),
                    entry["mode"],
                    entry["unit"],
                )
                existing = entries.setdefault(key, {**entry, "rates": {}})
                existing["rates"].update(entry["rates"])

    default_regions, usd_per_dbu = _foundation_model_sku_prices(cards)
    proprietary = _proprietary_model_sku_prices(cards)
    for entry in entries.values():
        vendor = entry.get("vendor")
        if vendor and vendor in proprietary:
            entry["usd_per_dbu"] = proprietary[vendor]

    return DatabricksPricingCatalog(
        sourceUrls=[*pages, DATABRICKS_PRICING_CARDS_URL],
        defaultRegions=default_regions,
        usdPerDbu=usd_per_dbu,
        entries=list(entries.values()),
    )


def _pricing_sections(value: object) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    if isinstance(value, dict):
        if (
            value.get("__typename") == "Drupal_ParagraphPricingRichtext"
            and "<table" in str(value.get("fieldDescription", {}).get("processed", ""))
        ):
            sections.append(value)
        for item in value.values():
            sections.extend(_pricing_sections(item))
    elif isinstance(value, list):
        for item in value:
            sections.extend(_pricing_sections(item))
    return sections


def _parse_pricing_tables(
    html: str,
    *,
    clouds: tuple[str, ...],
    vendor: str | None,
    source_url: str,
) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    parsed: list[dict[str, Any]] = []
    for table in soup.find_all("table"):
        heading = table.find_previous("h3")
        mode = _pricing_key(_text(heading))
        header_rows = _expanded_table_rows(table.select("thead tr"))
        body_rows = _expanded_table_rows(table.select("tbody tr"))
        if not header_rows or not body_rows:
            continue
        width = max(len(row) for row in [*header_rows, *body_rows])
        header_paths = [
            [
                row[column]
                for row in header_rows
                if column < len(row) and row[column]
            ]
            for column in range(width)
        ]
        unit = _pricing_unit(" ".join(value for path in header_paths for value in path))
        if unit is None:
            continue
        variant_column = 1 if width > 2 and not header_paths[1] else None
        first_rate_column = 2 if variant_column is not None else 1
        for row in body_rows:
            if not row:
                continue
            names = _pricing_names(row[0])
            if not names:
                continue
            variant = row[variant_column] if variant_column is not None else ""
            rates: dict[str, float] = {}
            for column in range(first_rate_column, width):
                if column >= len(row):
                    continue
                value = _pricing_number(row[column])
                if value is None:
                    continue
                dimension = header_paths[column][-1] if header_paths[column] else "rate"
                parts = []
                if mode != "pay_per_token":
                    parts.append(mode.removesuffix("_inference"))
                if variant:
                    parts.append(_pricing_key(variant))
                parts.append(_pricing_key(dimension))
                rates["_".join(filter(None, parts))] = value
            if rates:
                parsed.append(
                    {
                        "names": names,
                        "clouds": list(clouds),
                        "vendor": vendor,
                        "mode": mode,
                        "unit": unit,
                        "rates": rates,
                        "source_url": source_url,
                    }
                )
    return parsed


def _expanded_table_rows(rows: list[Tag]) -> list[list[str]]:
    expanded: list[list[str]] = []
    spans: dict[int, list[object]] = {}
    for row_tag in rows:
        cells = iter(row_tag.find_all(["th", "td"], recursive=False))
        row: list[str] = []
        column = 0
        cell = next(cells, None)
        while cell is not None or spans:
            if column in spans:
                remaining, value = spans[column]
                while len(row) <= column:
                    row.append("")
                row[column] = str(value)
                if int(remaining) <= 1:
                    del spans[column]
                else:
                    spans[column][0] = int(remaining) - 1
                column += 1
                continue
            if cell is None:
                next_columns = [value for value in spans if value > column]
                if not next_columns:
                    break
                column = min(next_columns)
                continue
            text = _text(cell)
            colspan = int(cell.get("colspan") or 1)
            rowspan = int(cell.get("rowspan") or 1)
            for offset in range(colspan):
                index = column + offset
                while len(row) <= index:
                    row.append("")
                row[index] = text
                if rowspan > 1:
                    spans[index] = [rowspan - 1, text]
            column += colspan
            cell = next(cells, None)
        expanded.append(row)
    return expanded


def _pricing_names(value: str) -> list[str]:
    cleaned = re.sub(r"[⌖*†‡]+", "", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return []
    parts = [part.strip() for part in cleaned.split(",") if part.strip()]
    prefix_match = re.match(r"^(.*?)(?=\d)", parts[0])
    prefix = prefix_match.group(1) if prefix_match else ""
    return [
        f"{prefix}{part}" if index and re.match(r"^\d", part) else part
        for index, part in enumerate(parts)
    ]


def _pricing_cloud(value: object) -> str | None:
    normalized = str(value).casefold()
    return "gcp" if normalized == "google" else normalized if normalized in DATABRICKS_CLOUD_PROVIDERS else None


def _pricing_key(value: str) -> str:
    value = value.casefold().replace("1m", "million")
    return re.sub(r"[^a-z0-9]+", "_", value).strip("_")


def _pricing_unit(value: str) -> str | None:
    normalized = value.casefold()
    if "per 1m tokens" in normalized:
        return "per_million_tokens"
    if "per hour per 50 model units" in normalized:
        return "per_hour_per_50_model_units"
    if "per hour" in normalized:
        return "per_hour"
    return None


def _pricing_number(value: object) -> float | None:
    normalized = str(value).strip().replace(",", "").removeprefix("$")
    if not normalized or normalized in {"-", "—", "n/a"}:
        return None
    try:
        return float(normalized)
    except ValueError:
        return None


def _foundation_model_sku_prices(
    cards: Mapping[str, Any],
) -> tuple[dict[str, str], dict[str, float]]:
    default_regions: dict[str, str] = {}
    usd_per_dbu: dict[str, float] = {}
    catalog = cards.get("fmServingSku")
    if not isinstance(catalog, dict):
        return default_regions, usd_per_dbu
    for external_cloud, cloud in _PRICING_CLOUD_NAMES.items():
        models = catalog.get(external_cloud)
        if not isinstance(models, dict) or not models:
            continue
        region_maps = [value for value in models.values() if isinstance(value, dict)]
        if not region_maps:
            continue
        for region in region_maps[0]:
            values = [_pricing_number(regions.get(region)) for regions in region_maps]
            if None in values or len(set(values)) != 1:
                continue
            rate = values[0]
            if rate is not None and (
                cloud not in usd_per_dbu or rate < usd_per_dbu[cloud]
            ):
                default_regions[cloud] = region
                usd_per_dbu[cloud] = rate
    return default_regions, usd_per_dbu


def _proprietary_model_sku_prices(
    cards: Mapping[str, Any],
) -> dict[str, dict[str, float]]:
    prices: dict[str, dict[str, float]] = {}
    plan = cards.get("premium") or cards.get("enterprise") or {}
    if not isinstance(plan, dict):
        return prices
    for external_cloud, cloud in _PRICING_CLOUD_NAMES.items():
        cloud_prices = plan.get(external_cloud)
        if not isinstance(cloud_prices, dict):
            continue
        vendor_prices = cloud_prices.get("prop_model_serving")
        if not isinstance(vendor_prices, dict):
            continue
        for vendor, value in vendor_prices.items():
            rate = _pricing_number(value)
            if rate is not None:
                prices.setdefault(_pricing_key(vendor), {})[cloud] = rate
    return prices


def fetch_url(url: str, headers: Mapping[str, str]) -> bytes:
    request = Request(url, headers={**headers, "user-agent": "dbx-model-catalog"})
    with urlopen(request) as response:
        return response.read()


def _hf_token(start: str | Path | None = None) -> str | None:
    configured = os.environ.get("HF_TOKEN")
    if configured:
        return configured
    directory = Path(start or Path.cwd()).resolve()
    if directory.is_file():
        directory = directory.parent
    for candidate in (directory, *directory.parents):
        env_file = candidate / ".env"
        if not env_file.is_file():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.removeprefix("export ").partition("=")
            if separator and key.strip() == "HF_TOKEN":
                token = value.strip()
                if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'":
                    token = token[1:-1]
                return token or None
        return None
    return None


def _read_cache(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _json_default(value: object) -> object:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", by_alias=True)
    raise TypeError(type(value).__name__)


def _text(tag: Tag | None) -> str:
    if tag is None:
        return ""
    value = " ".join(tag.stripped_strings)
    value = re.sub(r"[\u200b-\u200d\ufeff]", "", value)
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\s+([,.;:!?\)\]\}])", r"\1", value)
    value = re.sub(r"([\(\[\{])\s+", r"\1", value)
    return value.strip()


def _section_elements(soup: BeautifulSoup, heading_id: str) -> list[Tag]:
    heading = soup.find(id=heading_id)
    if not isinstance(heading, Tag) or not re.fullmatch(r"h[1-6]", heading.name or ""):
        raise ValueError(f"Databricks documentation is missing section {heading_id}")
    level = int(heading.name[1])
    elements: list[Tag] = []
    for sibling in heading.find_next_siblings():
        if re.fullmatch(r"h[1-6]", sibling.name or "") and int(sibling.name[1]) <= level:
            break
        elements.append(sibling)
    return elements


def _section_code_values(soup: BeautifulSoup, heading_id: str) -> list[str]:
    values = []
    for element in _section_elements(soup, heading_id):
        if element.name == "code":
            values.append(_text(element))
        values.extend(_text(code) for code in element.find_all("code"))
    return list(dict.fromkeys(value for value in values if _public_model_key(value)))


def _public_model_key(value: str) -> str:
    normalized = value.strip().rstrip("*").strip()
    normalized = re.sub(r"\s*\((?:public\s+)?(?:preview|beta|legacy)\)\s*$", "", normalized, flags=re.I)
    normalized = re.sub(r"^system\.ai[.-]", "", normalized, flags=re.I)
    normalized = re.sub(r"^databricks-", "", normalized, flags=re.I)
    normalized = re.sub(r"([a-z])([0-9])", r"\1-\2", normalized.casefold())
    normalized = re.sub(r"([0-9])([a-z])", r"\1-\2", normalized)
    return re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")


def _documented_integer(value: str) -> int | None:
    normalized = value.strip().replace(",", "")
    return int(normalized) if normalized.isdigit() else None


def _retirement_schedules(value: str) -> list[dict[str, Any]]:
    matches = list(
        re.finditer(
            r"(?P<offering>Pay-per-token|Provisioned throughput):\s*"
            r"(?P<date>[A-Z][a-z]+\s+\d{1,2},\s+\d{4})",
            value,
        )
    )
    schedules: dict[str, list[str]] = {}
    for match in matches:
        parsed = datetime.strptime(match.group("date"), "%B %d, %Y").date().isoformat()
        offering = (
            "pay_per_token"
            if match.group("offering") == "Pay-per-token"
            else "provisioned_throughput"
        )
        schedules.setdefault(offering, []).append(parsed)
    return [
        {"offering": offering, "dates": list(dict.fromkeys(dates))}
        for offering, dates in schedules.items()
    ]


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._depth = 0
        self._rows: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._depth += 1
            if self._depth == 1:
                self._rows = []
            return
        if self._depth != 1:
            return
        if tag in {"thead", "tbody", "tr"}:
            if tag == "tr":
                self._finish_row()
                self._row = []
            return
        if tag in {"th", "td"}:
            if self._row is None:
                self._row = []
            self._finish_cell()
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if self._depth == 1:
            if tag in {"th", "td"}:
                self._finish_cell()
            elif tag == "tr":
                self._finish_row()
        if tag == "table" and self._depth:
            if self._depth == 1:
                self._finish_row()
                if self._rows:
                    self.tables.append(self._rows)
                self._rows = None
            self._depth -= 1

    def handle_data(self, data: str) -> None:
        if self._depth == 1 and self._cell is not None:
            self._cell.append(data)

    def _finish_cell(self) -> None:
        if self._cell is None:
            return
        if self._row is None:
            self._row = []
        self._row.append(" ".join("".join(self._cell).split()))
        self._cell = None

    def _finish_row(self) -> None:
        self._finish_cell()
        if self._row and self._rows is not None:
            self._rows.append(self._row)
        self._row = None


def _html_tables(html: str) -> list[list[list[str]]]:
    parser = _TableParser()
    parser.feed(html)
    unique: dict[tuple[tuple[str, ...], ...], list[list[str]]] = {}
    for rows in parser.tables:
        key = tuple(tuple(cell for cell in row) for row in rows)
        unique.setdefault(key, rows)
    return list(unique.values())


def _join_paragraphs(values: list[str]) -> str:
    paragraphs = dict.fromkeys(value for value in values if value)
    return " ".join(
        value if value.endswith((".", "!", "?")) else f"{value}."
        for value in paragraphs
    )


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


def _notice_kind(tag: Tag | None) -> str | None:
    if tag is None:
        return None
    classes = " ".join(tag.get("class", []))
    match = re.search(r"(?:admonition[-_ ]?)?(note|important|warning|tip|caution|info)", classes, re.I)
    return match.group(1).lower() if match else None


def _parse_notice(tag: Tag, source_url: str) -> dict[str, object] | None:
    kind = _notice_kind(tag)
    if not kind:
        return None
    parts = []
    for paragraph in tag.find_all("p"):
        if paragraph.find_parent("p") is not None:
            continue
        value = _text(paragraph)
        if value.casefold() == kind:
            continue
        parts.append(value)
    text = " ".join(dict.fromkeys(parts))
    links = [
        {
            "label": _text(link) or "Linked documentation",
            "url": urljoin(source_url, link["href"]),
        }
        for link in tag.find_all("a", href=True)
        if urljoin(source_url, link["href"]).startswith(("http://", "https://"))
    ]
    return {"kind": kind, "text": text, "links": links} if text else None
