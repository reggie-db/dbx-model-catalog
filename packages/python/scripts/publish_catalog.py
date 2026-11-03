from __future__ import annotations

import argparse
from pathlib import Path

from dbx_model_catalog.publishing import write_catalog_artifacts
from dbx_model_catalog.sync import CatalogSync


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the normalized Databricks model catalog artifacts."
    )
    parser.add_argument(
        "--output-directory",
        type=Path,
        default=Path("site"),
        help="Directory for catalog.json and catalog.json.br.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Refresh source data before writing the normalized catalog.",
    )
    arguments = parser.parse_args()
    catalog = CatalogSync().sync(refresh=arguments.refresh)
    json_path, brotli_path = write_catalog_artifacts(
        catalog,
        arguments.output_directory,
    )
    print(json_path)
    print(brotli_path)


if __name__ == "__main__":
    main()
