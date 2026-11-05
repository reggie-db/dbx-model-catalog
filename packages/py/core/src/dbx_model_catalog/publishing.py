from __future__ import annotations

from pathlib import Path

from .database import write_catalog_database
from .models import ModelCatalog
from .search import build_catalog_search_index


def write_catalog_artifacts(
    catalog: ModelCatalog,
    output_directory: str | Path,
) -> Path:
    directory = Path(output_directory)
    directory.mkdir(parents=True, exist_ok=True)
    payload = catalog.model_dump_json(by_alias=True).encode("utf-8")
    json_path = directory / "catalog.json"
    json_path.write_bytes(payload + b"\n")
    search_index = build_catalog_search_index(catalog)
    (directory / "search-index.json").write_bytes(
        search_index.model_dump_json(by_alias=True).encode("utf-8") + b"\n"
    )
    write_catalog_database(catalog, search_index, directory / "catalog.sqlite")
    return json_path


__all__ = ["write_catalog_artifacts"]
