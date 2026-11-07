# dbx-model-catalog

`dbx-model-catalog` publishes a normalized catalog of Databricks-supported AI
models. Records combine model metadata, availability, pricing, limits,
capabilities, retirement notices, rankings, benchmarks, and links to the source
for each field.

The project is maintained in
[`reggie-db/dbx-model-catalog`](https://github.com/reggie-db/dbx-model-catalog).
JavaScript packages use the `@dbx-tools` scope.

## Published catalog

- Schema registry: <https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/index.json>
- Schema v15 JSON: <https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/v15/catalog.json>
- Schema v15 SQLite: <https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/v15/catalog.sqlite>
- Latest JSON alias: <https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog.json>

Raw GitHub artifacts from `main` provide the JSON and SQLite endpoints for
clients without requiring GitHub API authentication. Each contract is
published under `catalog/v<schema_version>/` so clients can stay on a
compatible schema while newer schemas coexist. The root `catalog.json`,
`search-index.json`, and `catalog.sqlite` files remain backward-compatible
aliases for the latest publication.

In the explorer, model names open the model details. Ranking and benchmark
values link to their upstream leaderboards; LM Arena entries use the official
Arena leaderboard and retain the exact Hugging Face dataset row as a secondary
source. The Columns menu controls visibility. Drag a table header handle to
reorder columns. Drag a column divider to resize it or double-click the divider
to restore its default width. Column visibility, order, and widths are saved in
local browser storage. Search matches across the catalog; each column header provides
field-specific filtering. Model details omit empty sections. The braces and
table icons switch between structured details and wrapped, syntax-highlighted
JSON. Single-source values link directly to their source; numbered source
markers are reserved for fields with multiple sources. Opening a model updates
the URL with a `model` query parameter, so the current detail view can be shared.

The catalog has this top-level shape:

```json
{
  "schema_version": 15,
  "updated_at": "2026-11-05T00:00:00Z",
  "models": {
    "databricks-model-id": {
      "name": "Model name",
      "status": "active",
      "availability": {},
      "average_price": {},
      "sources": {}
    }
  }
}
```

`updated_at` is the latest source-fetch timestamp represented by that catalog.
Schema consumers should check `schema_version`. The complete JSON Schema is at
`packages/py/core/src/dbx_model_catalog/schema/model-catalog.schema.json`.

## Raw HTTP clients

Download the current catalog:

```sh
curl -fsSL https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/v15/catalog.json \
  -o catalog.json
```

Use it directly from JavaScript:

```ts
const response = await fetch(
  "https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/v15/catalog.json",
);
if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);

const catalog = await response.json();
const activeModels = Object.entries(catalog.models)
  .filter(([, model]) => model.status === "active");
```

Download and query the maintained SQLite database:

```sh
curl -fsSL https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/v15/catalog.sqlite \
  -o catalog.sqlite
sqlite3 catalog.sqlite \
  "SELECT id, name FROM models WHERE status = 'active' ORDER BY name"
```

The database includes normalized model, availability, ranking, benchmark, and
search tables. `model_search` is an FTS5 index derived from the same Python
search documents used by the browser.

## Python client

The `dbx-model-catalog` Python package validates the published data with
Pydantic and provides typed list, filter, query, and ranked search operations.
`from_published()` caches the downloaded catalog for one hour by default.
The client builds one in-memory search index per catalog snapshot. Ranking
combines text relevance with separate version, freshness, lifecycle,
leaderboard, and benchmark signals. Leaderboards are age-decayed and missing
leaderboard or benchmark evidence is neutral, so a new model is not penalized
while evaluations catch up.

```py
from dbx_model_catalog import ModelCatalogClient

catalog = ModelCatalogClient.from_published()

active = catalog.filter({"status": ["active"], "limit": 20})
matches = catalog.search("reasoning model with tools", limit=5)
model = catalog.get("databricks-model-id")
```

Load a file or another compatible endpoint when needed:

```py
from pathlib import Path
from dbx_model_catalog import ModelCatalogClient

local = ModelCatalogClient.from_json(Path("catalog.json").read_bytes())
remote = ModelCatalogClient.from_url("https://example.com/catalog.json")
```

## Node client

The workspace package is `@dbx-tools/dbx-model-catalog`. Without a URL it
starts the bundled Python worker and connects over local IPC. With a WebSocket
URL it connects to an existing catalog server. The npm artifact carries the
Python service source, and the client asks uv to provision an isolated
environment on the first local connection.

The worker is only needed for the service-style Node API. It loads and validates
the Python-owned catalog contract, applies catalog filters, and runs the ranked
search implementation. It does not perform the explorer table's sorting or
column filtering.

```ts
import { connectModelCatalog } from "@dbx-tools/dbx-model-catalog";

await using catalog = await connectModelCatalog();
const models = await catalog.client.list({
  query: "gpt",
  status: ["active"],
  limit: 10,
});
```

Remote server use follows the same client contract:

```ts
await using catalog = await connectModelCatalog("wss://catalog.example.com");
const completeCatalog = await catalog.client.catalog();
```

Consumers that only need the published snapshot do not need Python or uv. The
`@dbx-tools/dbx-model-catalog/browser` entry point exports the generated types,
published artifact URLs, and a browser-safe client that can connect to an
existing WebSocket server. It never starts a local worker.

The Bun CLI supports local IPC and remote WebSocket access:

```sh
bun run chanx-model-catalog models gpt
bun run chanx-model-catalog model-feed gpt
bun run chanx-model-catalog models gpt --url ws://127.0.0.1:8787
```

## Server and explorer

Start the local server and browser:

```sh
bun run serve
```

The server listens on `http://127.0.0.1:8787`. It exposes the catalog over
WebSocket channels and provides `/health`, `/asyncapi`, and `/asyncapi.json`.
The local browser uses the WebSocket service. Static builds for Docker or
another external host fetch the schema-scoped artifacts from the repository's
`main` branch.

In static mode, the explorer fetches `catalog.json` and `search-index.json`
directly from GitHub. Ranked text search, table sorting, and column filtering
run in the browser; no Python process or WebSocket server is involved.
Search, filters, sorting, and the open model view are encoded in the URL hash,
so copying the browser URL preserves the current results and selection. Column
layout preferences remain local to each browser. Unknown or outdated view
fields are ignored when older links are opened.

Set `DBX_MODEL_CATALOG_PATH` to use an explicit local JSON artifact. Without
that variable, the Python service loads the published catalog.

### Static Docker demo

Run the published public image from GHCR:

```sh
docker run --rm -p 8080:8080 ghcr.io/reggie-db/dbx-model-catalog:latest
```

The workflow also publishes immutable `sha-<commit>` tags for deployments that
should not move automatically. To build the same image locally:

```sh
bun run container:build
bun run container:run
```

Open <http://localhost:8080>. The container serves only the compiled explorer.
At runtime the browser fetches the schema-scoped catalog and search index from
`raw.githubusercontent.com` on the repository's `main` branch, so GitHub
remains the source of truth. The image does not contain `catalog.json`,
`search-index.json`, `catalog.sqlite`, or the version registry.

The image uses an unprivileged Bun static server and keeps `/healthz` available
for container health checks. Set `DBX_MODEL_CATALOG_HEAD_HTML` to a complete raw
head fragment, a script URL, or a JSON array containing multiple values. Plain
HTTP and HTTPS URLs are automatically wrapped in deferred script elements. Raw
markup is inserted unchanged, so an Umami deployment can supply its complete
script element without rebuilding the image:

```sh
DBX_MODEL_CATALOG_HEAD_HTML='<script
  defer
  src="https://analytics.example.com/script.js"
  data-website-id="YOUR_WEBSITE_ID"
></script>' \
  bun run container:run
```

For a script that does not require additional attributes, pass its URL directly:

```sh
DBX_MODEL_CATALOG_HEAD_HTML=https://analytics.example.com/script.js \
  bun run container:run
```

Use a JSON array when more than one script or head fragment is required.

Only set this variable from trusted deployment configuration. Its values are
inserted verbatim so script attributes and other head markup remain intact.

Container operations are available as repository scripts:

- `bun run container:build` builds and loads `dbx-model-catalog-demo`.
- `bun run container:run` runs the image on port `8080` and forwards
  `DBX_MODEL_CATALOG_HEAD_HTML` when it is set.
- `bun run container:smoke` builds the image, checks `/healthz`, verifies head
  injection, and confirms that catalog payloads are absent.
- `bun run container:publish` publishes with Buildx, provenance, and an SBOM.
- `bun run container:verify` anonymously reads the registry manifest and checks
  the runtime user, port, command, health check, and optional expected revision.

Override `CONTAINER_IMAGE`, `CONTAINER_PORT`, or `CONTAINER_PLATFORM` when
needed. Local registry and Docker host mappings are opt-in through
`NPM_CONFIG_REGISTRY` and `CONTAINER_ADD_HOST`; neither has a repository default.
The GitHub workflow uses the same publish and verification scripts.

## Catalog publication

`.github/workflows/refresh-catalog.yml` runs every three days and can also be
started manually. Each run:

1. Fetches every configured source with `--refresh`.
2. Normalizes and validates the complete catalog.
3. Builds and validates the JSON catalog, search index, and SQLite database.
4. Publishes the latest aliases plus the current `catalog/v<schema_version>/`
   lane and updates `catalog/index.json` without deleting older schema lanes.
5. Commits the generated catalog artifacts when data changed.

Source responses and intermediate files remain ephemeral on the GitHub runner.
`HF_TOKEN` is an optional Actions secret used for authenticated Hugging Face
requests and higher rate limits.

Run the same publication locally:

```sh
bun run sync --refresh --output-directory packages/js/web
```

## Development

Install dependencies and run the complete validation suite:

```sh
bun install
bun run check
```

Build all generated clients, the Node package, the browser, and the Python
distribution:

```sh
bun run build
```

The repository layout is:

- `packages/py/core`: schema, Pydantic models, loading, filtering, and search
- `packages/py/server`: WebSocket server and local Python worker
- `packages/py/sync`: source ingestion, normalization, and catalog publication
- `packages/js/client`: generated service contract plus browser and Node/Bun clients
- `packages/js/web`: catalog explorer and published JSON, search, and SQLite artifacts

Python owns the schema and service contract. The generation step produces the
TypeScript types in `packages/js/client/src/_generated`; handwritten TypeScript
does not duplicate the Python models.
