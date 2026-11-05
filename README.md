# dbx-model-catalog

`dbx-model-catalog` publishes a normalized catalog of Databricks-supported AI
models. Records combine model metadata, availability, pricing, limits,
capabilities, retirement notices, rankings, benchmarks, and links to the source
for each field.

The project is maintained in
[`reggie-db/dbx-model-catalog`](https://github.com/reggie-db/dbx-model-catalog).
JavaScript packages use the `@dbx-tools` scope.

## Published catalog

- Explorer: <https://reggie-db.github.io/dbx-model-catalog/>
- Stable JSON: <https://reggie-db.github.io/dbx-model-catalog/catalog.json>

GitHub Pages is the public distribution endpoint. It provides a stable URL for
clients without requiring release-tag discovery or GitHub API authentication.
The repository stores one generated data artifact:
`packages/js/web/catalog.json`.

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

Schema consumers should check `schema_version`. The complete JSON Schema is at
`packages/py/common/src/dbx_model_catalog/schema/model-catalog.schema.json`.

## Raw HTTP clients

Download the current catalog:

```sh
curl -fsSL https://reggie-db.github.io/dbx-model-catalog/catalog.json \
  -o catalog.json
```

Use it directly from JavaScript:

```ts
const response = await fetch(
  "https://reggie-db.github.io/dbx-model-catalog/catalog.json",
);
if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);

const catalog = await response.json();
const activeModels = Object.entries(catalog.models)
  .filter(([, model]) => model.status === "active");
```

## Python client

The `dbx-model-catalog` Python package validates the published data with
Pydantic and provides typed list, filter, query, and ranked search operations.
`from_published()` caches the downloaded catalog for one hour by default.

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
starts the Python Pynect worker and connects over local IPC. With a WebSocket
URL it connects to an existing catalog server.

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
Pynect WebSocket channels and provides `/health`, `/asyncapi`, and
`/asyncapi.json`. The local browser uses the WebSocket service. The Pages build
loads its colocated `catalog.json` directly.

Set `DBX_MODEL_CATALOG_PATH` to use an explicit local JSON artifact. Without
that variable, the Python service loads the published catalog.

## Catalog publication

`.github/workflows/refresh-catalog.yml` runs every three days and can also be
started manually. Each run:

1. Fetches every configured source with `--refresh`.
2. Normalizes and validates the complete catalog.
3. Commits only `packages/js/web/catalog.json` when data changed.
4. Triggers the Pages deployment after the publication workflow succeeds.

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

- `packages/py/common`: schema, Pydantic models, loading, filtering, and search
- `packages/py/server`: Chanx WebSocket server and Pynect worker
- `packages/py/sync`: source ingestion, normalization, and catalog publication
- `packages/js/common`: generated Pynect contract and shared client wrapper
- `packages/js/node`: Node/Bun IPC and WebSocket client
- `packages/js/sync`: Bun entry point for the Python synchronization package
- `packages/js/web`: catalog explorer and the published JSON artifact

Python owns the schema and service contract. Pynect generates the TypeScript
types in `packages/js/common/src/_generated`; handwritten TypeScript does not
duplicate the Python models.
