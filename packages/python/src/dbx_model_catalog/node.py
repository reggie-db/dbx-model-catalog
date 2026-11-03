from __future__ import annotations

from collections.abc import Mapping
from dataclasses import fields
from typing import Any

from .client import ModelCatalogClient
from .sync import CatalogSync, CatalogSyncSources

JsonObject = dict[str, Any]
JsonQuery = Mapping[str, Any]


class NodeModelCatalogClient:
    def __init__(self, catalog: dict[str, Any]) -> None:
        self._client = ModelCatalogClient.from_catalog(catalog)

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

    def get(self, model_id: str) -> JsonObject | None:
        model = self._client.get(model_id)
        return None if model is None else model.model_dump(mode="json")

    def list(self) -> list[JsonObject]:
        return [model.model_dump(mode="json") for model in self._client.list()]

    def query(
        self,
        expression: dict[str, Any] | None = None,
        options: dict[str, Any] | None = None,
    ) -> list[JsonObject]:
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
    "JsonObject",
    "JsonQuery",
    "NodeCatalogSync",
    "NodeModelCatalogClient",
]
