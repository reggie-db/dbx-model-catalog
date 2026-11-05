from __future__ import annotations

from pathlib import Path

from .models import ModelCatalog


def write_catalog_artifacts(
    catalog: ModelCatalog,
    output_directory: str | Path,
) -> Path:
    directory = Path(output_directory)
    directory.mkdir(parents=True, exist_ok=True)
    payload = catalog.model_dump_json(by_alias=True).encode("utf-8")
    json_path = directory / "catalog.json"
    json_path.write_bytes(payload + b"\n")
    return json_path


__all__ = ["write_catalog_artifacts"]
