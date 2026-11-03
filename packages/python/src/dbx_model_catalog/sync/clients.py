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
from pathlib import Path
from typing import Any, Generic, TypeVar
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
            if path.endswith(".parquet")
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
            rows = [
                LMArenaRow.model_validate(row)
                for row in parquet.read_table(local).to_pylist()
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
        for record in csv.DictReader(table.splitlines()):
            model = (record.pop("model", None) or "").strip()
            if not model:
                raise ValueError("LiveBench leaderboard row is missing its model")
            scores = {name: None if not value.strip() else float(value) for name, value in record.items()}
            rows.append(LiveBenchRow(model=model, scores=scores))
        return self.parse(
            {"dataset": LIVEBENCH_DATASET, "release": release, "metadata": metadata, "categories": categories, "rows": rows}
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
        return DatabricksCatalogData(
            pricing=DatabricksPricingCatalog(), cloudProviders=providers
        )


def parse_databricks_supported_models_page(html: str, source_url: str) -> DatabricksSupportedModelsPage:
    soup = BeautifulSoup(html, "html.parser")
    canonical = soup.select_one('link[rel="canonical"]')
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
                notice = _parse_notice(element)
                if notice:
                    models[-1].notices.append(DatabricksNotice.model_validate(notice))
            continue
        if element.name == "div":
            continue
        if element.find_parent("div") is not None and _notice_kind(element.find_parent("div")):
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
        model.description = " ".join(model.paragraphs)
    models = [model for model in models if model.endpoint_name or model.service_name]
    return DatabricksSupportedModelsPage(
        metadata={
            "sourceUrl": canonical.get("href") if canonical else source_url,
            "title": title,
            "description": description.get("content") if description else None,
            "modifiedAt": modified.get("content") if modified else None,
        },
        introduction=introduction,
        models=models,
        additionalResources=[],
    )


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
    return " ".join(tag.stripped_strings) if tag else ""


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


def _notice_kind(tag: Tag | None) -> str | None:
    if tag is None:
        return None
    classes = " ".join(tag.get("class", []))
    match = re.search(r"(?:admonition[-_ ]?)?(note|important|warning|tip|caution|info)", classes, re.I)
    return match.group(1).lower() if match else None


def _parse_notice(tag: Tag) -> dict[str, object] | None:
    kind = _notice_kind(tag)
    if not kind:
        return None
    parts = []
    for paragraph in tag.find_all("p"):
        value = _text(paragraph)
        if value.casefold() == kind:
            continue
        parts.append(value)
    text = " ".join(parts)
    return {"kind": kind, "text": text, "links": []} if text else None
