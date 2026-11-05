from __future__ import annotations

import argparse
from collections.abc import Sequence

from .publishing import publish_catalog


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="dbx-model-catalog-sync",
        description="Refresh and publish the Databricks model catalog.",
    )
    parser.add_argument(
        "--output-directory",
        default="packages/js/web",
        help="Directory that receives catalog.json, search-index.json, and catalog.sqlite.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Ignore cached source responses.",
    )
    options = parser.parse_args(argv)
    publish_catalog(options.output_directory, refresh=options.refresh)
    return 0


__all__ = ["main"]
