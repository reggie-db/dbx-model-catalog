from pathlib import Path

from dbx_model_catalog.publishing import write_catalog_artifacts

from .catalog import CatalogSync


def publish_catalog(
    output_directory: str | Path,
    *,
    refresh: bool = False,
) -> tuple[Path, Path]:
    catalog = CatalogSync().sync(refresh=refresh)
    return write_catalog_artifacts(catalog, output_directory)


__all__ = ["publish_catalog"]
