#!/usr/bin/env bash
set -euo pipefail

image="${CONTAINER_IMAGE:-dbx-model-catalog-demo}"
host_port="${CONTAINER_PORT:-8080}"
args=(docker run --rm --publish "${host_port}:8080")

if [[ -n "${DBX_MODEL_CATALOG_HEAD_HTML:-}" ]]; then
  args+=(--env "DBX_MODEL_CATALOG_HEAD_HTML=$DBX_MODEL_CATALOG_HEAD_HTML")
fi
if [[ -n "${CONTAINER_NAME:-}" ]]; then
  args+=(--name "$CONTAINER_NAME")
fi

args+=("$image")
exec "${args[@]}"
