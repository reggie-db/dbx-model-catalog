#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${CONTAINER_IMAGE:-dbx-model-catalog-demo}"
name="dbx-model-catalog-smoke-$$"
marker='<meta name="container-smoke" content="passed">'

cleanup() {
  docker container rm --force "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ "${CONTAINER_SKIP_BUILD:-false}" != "true" ]]; then
  "$root/scripts/container-build.sh"
fi

docker run --detach --name "$name" \
  --publish 127.0.0.1::8080 \
  --env "DBX_MODEL_CATALOG_HEAD_HTML=$marker" \
  "$image" >/dev/null

port="$(docker port "$name" 8080/tcp | awk -F: 'NR == 1 { print $NF }')"
if [[ -z "$port" ]]; then
  echo 'Could not resolve the smoke-test port.' >&2
  exit 1
fi

for _ in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:$port/healthz" >/dev/null; then
    break
  fi
  sleep 1
done

curl --fail --silent "http://127.0.0.1:$port/healthz" | grep --fixed-strings 'ok' >/dev/null
curl --fail --silent "http://127.0.0.1:$port/" | grep --fixed-strings "$marker" >/dev/null

for path in /app/public/catalog /app/public/catalog.json /app/public/catalog.sqlite /app/public/search-index.json; do
  if docker exec "$name" test -e "$path"; then
    echo "Unexpected catalog payload in image: $path" >&2
    exit 1
  fi
done

echo "Container smoke test passed on http://127.0.0.1:$port"
