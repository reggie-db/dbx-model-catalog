# dbx-model-catalog

`dbx-model-catalog` publishes a normalized catalog of Databricks-supported AI
models. Records combine model metadata, availability, pricing, limits,
capabilities, retirement notices, rankings, benchmarks, and links to the source
for each field.

The project is maintained in
[`reggie-db/dbx-model-catalog`](https://github.com/reggie-db/dbx-model-catalog).
JavaScript packages use the `@dbx-tools` scope.

## Published catalog

- Explorer: <https://model-catalog.dbx.tools/>
- Stable JSON: <https://model-catalog.dbx.tools/catalog.json>
- SQLite database: <https://model-catalog.dbx.tools/catalog.sqlite>

GitHub Pages is the public distribution endpoint. It provides a stable URL for
clients without requiring release-tag discovery or GitHub API authentication.
The repository stores the generated catalog, its Python-owned derived search
index, and a queryable SQLite database in `packages/js/web/catalog.json`,
`packages/js/web/search-index.json`, and `packages/js/web/catalog.sqlite`.

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
`packages/py/core/src/dbx_model_catalog/schema/model-catalog.schema.json`.

## Raw HTTP clients

Download the current catalog:

```sh
curl -fsSL https://model-catalog.dbx.tools/catalog.json \
  -o catalog.json
```

Use it directly from JavaScript:

```ts
const response = await fetch(
  "https://model-catalog.dbx.tools/catalog.json",
);
if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);

const catalog = await response.json();
const activeModels = Object.entries(catalog.models)
  .filter(([, model]) => model.status === "active");
```

Download and query the maintained SQLite database:

```sh
curl -fsSL https://model-catalog.dbx.tools/catalog.sqlite \
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
starts the Python Pynect worker and connects over local IPC. With a WebSocket
URL it connects to an existing catalog server. The npm artifact carries the
Python service source, and Pynect asks uv to provision its isolated environment
on the first local connection.

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
3. Builds and validates the JSON catalog, search index, and SQLite database.
4. Commits `packages/js/web/catalog.json`, `packages/js/web/search-index.json`,
   and `packages/js/web/catalog.sqlite` when data changed.
5. Triggers the Pages deployment after the publication workflow succeeds.

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
- `packages/py/server`: Chanx WebSocket server and Pynect worker
- `packages/py/sync`: source ingestion, normalization, and catalog publication
- `packages/js/client`: generated Pynect contract plus browser and Node/Bun clients
- `packages/js/web`: catalog explorer and published JSON, search, and SQLite artifacts

Python owns the schema and service contract. Pynect generates the TypeScript
types in `packages/js/client/src/_generated`; handwritten TypeScript does not
duplicate the Python models.
