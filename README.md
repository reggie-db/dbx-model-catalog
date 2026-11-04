# dbx-model-catalog

Python-first model catalog monorepo with generated Node and browser clients that
share one strongly typed Pynect contract over local IPC and WebSockets.

## Packages

- `packages/python` publishes `dbx-model-catalog`. It owns the Pydantic client,
  query DSL, source synchronization, catalog normalization, JSON Schema, and
  Hatch build hook.
- `packages/node` publishes `@regbo/dbx-model-catalog`. Pynect generates its
  TypeScript bridge from the Python package. Local Node and Bun callers use IPC,
  while browsers use the same generated module contract over WebSockets.

Node client generation uses Pynect `^0.8.5` from npm. Pynect supplies compatible
Pyfig, Loqkit, and Optionkit dependencies through npm; the workspace has no
GitHub links or vendored tarballs for those packages. The generated npm package
bundles that runtime. Its runtime defaults uv and Python provisioning to
Astral's release mirror rather than GitHub release endpoints.

The previous Zod, TypeScript client, and TypeScript sync packages have been
removed. The committed JSON Schema in the Python package remains the catalog
contract and generates the Pydantic models during builds.

## Published catalog

The normalized Databricks catalog is published as JSON and Brotli-compressed
JSON at <https://reggie-db.github.io/dbx-model-catalog/>. The page provides a
dbx.tools-branded explorer with filters, sortable headers, optional ranking and
benchmark columns, model details, and direct downloads. It is built with
`@dbx-tools/ui`, Databricks AppKit UI, TanStack Table, and LobeHub publisher
logos. Publisher values identify the model creator or lab, never an inference
gateway or reseller discovered in an upstream source. Raw upstream source
payloads are not published. The server-backed app uses the typed RPC client;
the GitHub Pages build falls back to its colocated normalized JSON artifact
because Pages cannot host the Bun RPC server.

`.github/workflows/refresh-catalog.yml` refreshes the normalized artifacts each
week and commits changes under `site/`. It restores the Python source and
normalization cache between runs. `.github/workflows/pages.yml` deploys that
directory through GitHub Pages whenever the site or catalog changes. The Pages
workflow builds the React explorer and publishes only `site/dist`.

## Development

Install Hatch and run the workspace checks:

```sh
hatch run check
```

Useful commands:

```sh
hatch run test
hatch run schema
hatch run node-generate
hatch run node-build
hatch run build
bun run catalog:publish
bun run sync --format
bun run site:check
bun run site:serve
```

The Node package also publishes a `dbx-model-catalog` CLI. Its parser is an
optional dependency installed lazily on first use, following the same pattern
as Pyfig. The command runs the Python sync implementation through the bundled
Pynect bridge; the Python package does not publish a CLI entry point.

```sh
dbx-model-catalog sync
dbx-model-catalog sync --format
dbx-model-catalog sync --raw --format
dbx-model-catalog lookup gpt --status active preview --task reasoning
dbx-model-catalog lookup --type embedding --input-modality text --limit 10 --format
dbx-model-catalog lookup --capability tools structured-output --min-context 128000
dbx-model-catalog lookup gpt --refresh
```

The Node-only `lookup` command synchronizes the normalized catalog and passes
its filters to the Python query DSL. It includes typed identity, lifecycle,
task, modality, capability, token-limit, date, sort, and limit options, plus an
`--expression` JSON escape hatch for the complete DSL.

The completed normalized catalog uses DiskCache for one-hour, SQLite-backed
persistence under the system temporary directory. Warm `lookup` and normalized
`sync` commands reuse that catalog without fetching or parsing sources. Pass
`--refresh` to evict and rebuild it immediately, refresh the source caches, and
replace the normalized cache.

`bun run site:serve` builds the explorer and starts the site with a Pynect
WebSocket endpoint at `/pynect`. The Bun server launches the official
`pynect-worker[server]` Python CLI from Pynect's bundled wheel through Pyfig and
proxies binary WebSocket upgrades without defining another HTTP RPC contract.

The browser and local Node clients import the same generated Python modules and
use the same `NodeModelCatalogClient` interface. Node uses Pynect's local IPC
transport; the browser uses Pynect's WebSocket transport.

Hugging Face-backed sources use `HF_TOKEN` from the process environment. When
it is unset, the sync client walks upward from the current directory to the
nearest `.env` and reads only its `HF_TOKEN` entry. The repository already
ignores `.env`, so a local root file can contain:

```dotenv
HF_TOKEN=your-token
```

`hatch run build` creates the Python sdist and wheel. The wheel build hook also
generates the Pynect bridge, builds the Node package, and embeds a publish-ready
npm tarball under `packages/python/dist-node`.

Publishing remains explicit rather than happening as a side effect of a normal
build:

```sh
hatch run publish:python
hatch run publish:node
```

## Python

```py
from dbx_model_catalog import CatalogQueryOptions, ModelCatalogClient

catalog = ModelCatalogClient.from_published()

models = catalog.query(
    {"status": "active", "tasks": ["reasoning", "chat"]},
    CatalogQueryOptions(order_by="name", limit=20),
)
```

`from_published()` caches the compressed payload in the platform-native user
cache directory for one hour. Pass `refresh=True` to replace the local copy.

`list()` returns a standard typed list for native filtering and sorting:

```py
models = catalog.list()
models = [model for model in models if model.status.value == "active"]
models.sort(key=lambda model: model.name.casefold())
```

The Python distribution also exposes `dbx_model_catalog.sync` for models.dev,
modelparams.dev, LiveBench, Databricks documentation, cache handling, and
catalog normalization.

## Node and Bun

```ts
import { DbxModelCatalogPython } from "@regbo/dbx-model-catalog";

await using python = new DbxModelCatalogPython();
const catalogModule = await python.client;
const catalog = await catalogModule.NodeModelCatalogClient();

console.log(await catalog.get_size());
console.log(await catalog.query(
  { status: { $eq: "active" }, capabilities: { tools: { $eq: true } } },
  { orderBy: "name", limit: 10 },
));
```

The Node client contains no separate catalog implementation. Pynect constructs
the Python client, downloads the same published Brotli artifact, and reuses the
same Python DiskCache-backed local payload cache.

The generated default requests `dbx-model-catalog>=<matching version>` from
`uv`. Callers can override any Pynect environment option:

```ts
const python = new DbxModelCatalogPython({
  project: false,
  with: ["dbx-model-catalog", "polars"],
});
```

This is the runtime route:

1. The Node package starts its bundled Pynect bridge lazily.
2. Pynect asks Pyfig for a compatible `uv` and Python.
3. Pyfig reuses installed executables when compatible and provisions missing
   executables when necessary.
4. Pynect launches `uv run` with the configured project and `with`
   dependencies.
5. `uv` creates or reuses the environment, installs the Python dependencies,
   and starts the persistent Pynect worker.

Neither `uv` nor Python must already be installed for a normal published Node
client invocation. The generated client requests the latest available
`dbx-model-catalog` package without pinning it. In a development checkout, pass
`project: false`, `with: []`, and `withEditable: ["../python"]` to use the local
Hatch package instead. The site server selects that editable checkout
automatically when `packages/python/pyproject.toml` exists.

The browser binding exposes the same generated module contract as local IPC:

```ts
import { DbxModelCatalogWebSocket } from "@regbo/dbx-model-catalog/rpc";

await using python = new DbxModelCatalogWebSocket({
  baseUrl: "http://127.0.0.1:8000",
});
const module = await python.client;
const client = await module.NodeModelCatalogClient();
console.log(await client.query(
  { status: { $eq: "active" } },
  { orderBy: "name", limit: 10 },
));
```

In a browser, omit `baseUrl` to use `window.location.origin`.
