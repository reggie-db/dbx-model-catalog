from __future__ import annotations

from collections.abc import Mapping
from dataclasses import fields
from typing import Any, TypedDict

from .client import (
    PUBLISHED_CATALOG_CACHE_TTL,
    PUBLISHED_CATALOG_URL,
    ModelCatalogClient,
)
from ._generated.node_types import CatalogModel, ModelCatalog
from .sync import CatalogSync, CatalogSyncSources

JsonObject = dict[str, Any]
JsonQuery = Mapping[str, Any]


class CatalogModelRecord(CatalogModel, TypedDict):
    id: str


class NodeModelCatalogClient:
    def __init__(
        self,
        catalog: dict[str, Any] | None = None,
        refresh: bool = False,
        url: str = PUBLISHED_CATALOG_URL,
        cache_directory: str | None = None,
        cache_ttl: float = PUBLISHED_CATALOG_CACHE_TTL,
    ) -> None:
        self._client = (
            ModelCatalogClient.from_published(
                refresh=refresh,
                url=url,
                cache_directory=cache_directory,
                cache_ttl=cache_ttl,
            )
            if catalog is None
            else ModelCatalogClient.from_catalog(catalog)
        )

    @classmethod
    def from_json(cls, value: str) -> NodeModelCatalogClient:
        return cls(ModelCatalogClient.from_json(value).catalog.model_dump())

    @classmethod
    def from_brotli(cls, value: bytes) -> NodeModelCatalogClient:
        return cls(ModelCatalogClient.from_brotli(value).catalog.model_dump())

    def get_schema_version(self) -> int:
        return self._client.schema_version

    def get_size(self) -> int:
        return self._client.size

    def get_updated_at(self) -> str:
        return self._client.updated_at.isoformat()

    def get_catalog(self) -> ModelCatalog:
        return self._client.catalog.model_dump(mode="json", by_alias=True)

    def get(self, model_id: str) -> CatalogModelRecord | None:
        model = self._client.get(model_id)
        return None if model is None else model.model_dump(mode="json")

    def list(self) -> list[CatalogModelRecord]:
        return [model.model_dump(mode="json") for model in self._client.list()]

    def all(self) -> list[CatalogModelRecord]:
        return self.list()

    def query(
        self,
        expression: dict[str, Any] | None = None,
        options: dict[str, Any] | None = None,
    ) -> list[CatalogModelRecord]:
        return [
            model.model_dump(mode="json")
            for model in self._client.query(expression, options)
        ]


class NodeCatalogSync:
    def sync(self, raw: bool = False, refresh: bool = False) -> JsonObject:
        catalog_sync = CatalogSync()
        if raw:
            return _sync_sources_json(catalog_sync.sync_sources(refresh=refresh))
        return catalog_sync.sync(refresh=refresh).model_dump(mode="json", by_alias=True)


def _sync_sources_json(sources: CatalogSyncSources) -> JsonObject:
    return {
        _camel_case(field.name): getattr(sources, field.name).model_dump(
            mode="json", by_alias=True
        )
        for field in fields(sources)
    }


def _camel_case(value: str) -> str:
    first, *remaining = value.split("_")
    return first + "".join(part.title() for part in remaining)


__all__ = [
    "CatalogModelRecord",
    "JsonObject",
    "JsonQuery",
    "NodeCatalogSync",
    "NodeModelCatalogClient",
]
