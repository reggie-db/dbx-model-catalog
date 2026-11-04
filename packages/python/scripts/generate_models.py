from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = (
    PACKAGE_ROOT
    / "src"
    / "dbx_model_catalog"
    / "schema"
    / "model-catalog.schema.json"
)
OUTPUT_PATH = (
    PACKAGE_ROOT
    / "src"
    / "dbx_model_catalog"
    / "_generated"
    / "models.py"
)
NODE_TYPES_OUTPUT_PATH = (
    PACKAGE_ROOT
    / "src"
    / "dbx_model_catalog"
    / "_generated"
    / "node_types.py"
)


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "datamodel_code_generator",
            "--input",
            str(SCHEMA_PATH),
            "--input-file-type",
            "jsonschema",
            "--output",
            str(OUTPUT_PATH),
            "--output-model-type",
            "pydantic_v2.BaseModel",
            "--target-python-version",
            "3.12",
            "--use-union-operator",
            "--use-standard-collections",
            "--use-schema-description",
            "--use-field-description",
            "--formatters",
            "builtin",
            "--disable-timestamp",
        ],
        cwd=PACKAGE_ROOT,
        check=True,
    )
    subprocess.run(
        [
            sys.executable,
            "-m",
            "datamodel_code_generator",
            "--input",
            str(SCHEMA_PATH),
            "--input-file-type",
            "jsonschema",
            "--output",
            str(NODE_TYPES_OUTPUT_PATH),
            "--output-model-type",
            "typing.TypedDict",
            "--target-python-version",
            "3.12",
            "--use-union-operator",
            "--use-standard-collections",
            "--use-schema-description",
            "--no-use-closed-typed-dict",
            "--formatters",
            "builtin",
            "--disable-timestamp",
        ],
        cwd=PACKAGE_ROOT,
        check=True,
    )


if __name__ == "__main__":
    main()
