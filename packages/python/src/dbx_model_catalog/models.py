from __future__ import annotations

from typing import Annotated

from pydantic import Field

from ._generated.models import CatalogModel, ModelCatalog


class CatalogModelRecord(CatalogModel):
    id: Annotated[str, Field(min_length=1)]


__all__ = ["CatalogModel", "CatalogModelRecord", "ModelCatalog"]
