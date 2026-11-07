#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${CONTAINER_IMAGE:-ghcr.io/reggie-db/dbx-model-catalog}"
platform="${CONTAINER_PLATFORM:-linux/amd64}"

if [[ "${CONTAINER_DRY_RUN:-false}" != "true" ]] && ! docker buildx version >/dev/null 2>&1; then
  echo 'docker buildx is required to publish the container.' >&2
  exit 1
fi

tags="${CONTAINER_TAGS:-$image:latest}"
args=(docker buildx build --file "$root/Dockerfile" --platform "$platform" --push --provenance=mode=max --sbom=true)

while IFS= read -r tag; do
  [[ -n "$tag" ]] && args+=(--tag "$tag")
done <<< "$tags"
while IFS= read -r label; do
  [[ -n "$label" ]] && args+=(--label "$label")
done <<< "${CONTAINER_LABELS:-}"

if [[ -n "${CONTAINER_CACHE_FROM:-}" ]]; then
  args+=(--cache-from "$CONTAINER_CACHE_FROM")
fi
if [[ -n "${CONTAINER_CACHE_TO:-}" ]]; then
  args+=(--cache-to "$CONTAINER_CACHE_TO")
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
