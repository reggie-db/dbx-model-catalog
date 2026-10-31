from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Literal, TypeAlias
from urllib.request import urlopen

import brotli

from .models import CatalogModelRecord, ModelCatalog
from .query import CatalogQuery, CatalogQueryOptions, query_catalog_records

CatalogPayloadEncoding: TypeAlias = Literal["brotli", "json"]
CatalogFetch: TypeAlias = Callable[[str], bytes]
CatalogPayloadDecoder: TypeAlias = Callable[[bytes, CatalogPayloadEncoding], str]


class ModelCatalogClient:
    def __init__(self, catalog: ModelCatalog) -> None:
        self.catalog = catalog

    @classmethod
    def from_catalog(cls, value: ModelCatalog | Mapping[str, object]) -> ModelCatalogClient:
        return cls(ModelCatalog.model_validate(value))

    @classmethod
    def from_json(cls, value: str | bytes) -> ModelCatalogClient:
        return cls(ModelCatalog.model_validate_json(value))

    @classmethod
    def from_brotli(
        cls,
        value: bytes,
        *,
        decode: CatalogPayloadDecoder | None = None,
    ) -> ModelCatalogClient:
        decoder = decode or decode_catalog_payload
        return cls.from_json(decoder(value, "brotli"))

    @classmethod
    def from_url(
        cls,
        url: str,
        *,
        fetch: CatalogFetch | None = None,
        decode: CatalogPayloadDecoder | None = None,
    ) -> ModelCatalogClient:
        payload = (fetch or fetch_catalog)(url)
        encoding: CatalogPayloadEncoding = (
            "json" if _looks_like_json(payload) else "brotli"
        )
        return cls.from_json((decode or decode_catalog_payload)(payload, encoding))

    @property
    def schema_version(self) -> Literal[11]:
        return self.catalog.schema_version

    @property
    def updated_at(self) -> datetime:
        return self.catalog.updated_at

    @property
    def size(self) -> int:
        return len(self.catalog.models)

    def get(self, model_id: str) -> CatalogModelRecord | None:
        model = self.catalog.models.get(model_id)
        if model is None:
            return None
        return CatalogModelRecord(id=model_id, **model.model_dump())

    def all(self) -> list[CatalogModelRecord]:
        return [
            CatalogModelRecord(id=model_id, **model.model_dump())
            for model_id, model in self.catalog.models.items()
        ]

    def query(
        self,
        expression: CatalogQuery | None = None,
        options: CatalogQueryOptions | Mapping[str, object] | None = None,
    ) -> list[CatalogModelRecord]:
        return query_catalog_records(self.all(), expression, options)


def fetch_catalog(url: str) -> bytes:
    with urlopen(url) as response:
        return response.read()


def decode_catalog_payload(payload: bytes, encoding: CatalogPayloadEncoding) -> str:
    decoded = payload if encoding == "json" else brotli.decompress(payload)
    return decoded.decode("utf-8")


def _looks_like_json(payload: bytes) -> bool:
    return payload.lstrip().startswith(b"{")


__all__ = [
    "CatalogFetch",
    "CatalogPayloadDecoder",
    "CatalogPayloadEncoding",
    "ModelCatalogClient",
    "decode_catalog_payload",
    "fetch_catalog",
]
