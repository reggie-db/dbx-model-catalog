#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${CONTAINER_IMAGE:-dbx-model-catalog-demo}"
platform="${CONTAINER_PLATFORM:-linux/amd64}"

args=(docker build --file "$root/Dockerfile" --platform "$platform" --tag "$image")
if docker buildx version >/dev/null 2>&1; then
  args=(docker buildx build --file "$root/Dockerfile" --platform "$platform" --tag "$image" --load)
fi

if [[ -n "${NPM_CONFIG_REGISTRY:-}" ]]; then
  args+=(--build-arg "NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY")
fi
if [[ -n "${CONTAINER_ADD_HOST:-}" ]]; then
  args+=(--add-host "$CONTAINER_ADD_HOST")
fi

args+=("$root")
if [[ "${CONTAINER_DRY_RUN:-false}" == "true" ]]; then
  printf '%q ' "${args[@]}"
  printf '\n'
  exit 0
fi

exec "${args[@]}"
