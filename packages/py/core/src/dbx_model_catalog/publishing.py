from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from shutil import copyfile

from .database import write_catalog_database
from .models import ModelCatalog
from .search import build_catalog_search_index

CATALOG_ARTIFACT_NAMES = (
    "catalog.json",
    "search-index.json",
    "catalog.sqlite",
)
CATALOG_VERSION_DIRECTORY = "catalog"
CATALOG_VERSION_INDEX = "index.json"


def catalog_schema_directory(schema_version: int) -> str:
    return f"v{schema_version}"


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

    catalog_directory = directory / CATALOG_VERSION_DIRECTORY
    version_directory = catalog_directory / catalog_schema_directory(
        catalog.schema_version
    )
    version_directory.mkdir(parents=True, exist_ok=True)
    for artifact_name in CATALOG_ARTIFACT_NAMES:
        copyfile(directory / artifact_name, version_directory / artifact_name)
    _write_catalog_version_index(catalog, catalog_directory)
    return json_path


def _write_catalog_version_index(
    catalog: ModelCatalog,
    catalog_directory: Path,
) -> None:
    versions = []
    for version_directory in sorted(
        catalog_directory.iterdir(),
        key=lambda path: _schema_version_from_directory(path) or -1,
    ):
        schema_version = _schema_version_from_directory(version_directory)
        if schema_version is None:
            continue
        catalog_path = version_directory / "catalog.json"
        if not catalog_path.is_file():
            continue
        payload = json.loads(catalog_path.read_text())
        payload_schema_version = payload.get("schema_version")
        updated_at = payload.get("updated_at")
        if payload_schema_version != schema_version:
            raise ValueError(
                f"Catalog schema path {version_directory} contains "
                f"schema_version={payload_schema_version!r}"
            )
        if not isinstance(updated_at, str):
            raise ValueError(f"Catalog {catalog_path} is missing updated_at")
        for artifact_name in CATALOG_ARTIFACT_NAMES:
            artifact_path = version_directory / artifact_name
            if not artifact_path.is_file():
                raise ValueError(f"Catalog schema artifact is missing: {artifact_path}")
        versions.append(
            {
                "schema_version": schema_version,
                "updated_at": updated_at,
                "catalog": f"{version_directory.name}/catalog.json",
                "search_index": f"{version_directory.name}/search-index.json",
                "database": f"{version_directory.name}/catalog.sqlite",
            }
        )

    index = {
        "latest_schema_version": catalog.schema_version,
        "updated_at": _json_datetime(catalog.updated_at),
        "versions": versions,
    }
    (catalog_directory / CATALOG_VERSION_INDEX).write_text(
        json.dumps(index, separators=(",", ":")) + "\n"
    )


def _schema_version_from_directory(path: Path) -> int | None:
    if not path.is_dir():
        return None
    match = re.fullmatch(r"v([1-9][0-9]*)", path.name)
    return None if match is None else int(match.group(1))


def _json_datetime(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


__all__ = [
    "CATALOG_ARTIFACT_NAMES",
    "CATALOG_VERSION_DIRECTORY",
    "CATALOG_VERSION_INDEX",
    "catalog_schema_directory",
    "write_catalog_artifacts",
]
