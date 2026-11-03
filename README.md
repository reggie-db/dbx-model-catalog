# dbx-model-catalog

Python-first model catalog monorepo with a generated Node and Bun client.

## Packages

- `packages/python` publishes `dbx-model-catalog`. It owns the Pydantic client,
  query DSL, source synchronization, catalog normalization, JSON Schema, and
  Hatch build hook.
- `packages/node` publishes `@regbo/dbx-model-catalog`. Pynect generates its
  TypeScript bridge from the Python package.

Node client generation uses Pynect `^0.8.2` from npm. Pynect supplies compatible
Pyfig, Loqkit, and Optionkit dependencies through npm; the workspace has no
GitHub links or vendored tarballs for those packages. The generated npm package
bundles that runtime. Its runtime defaults uv and Python provisioning to
Astral's release mirror rather than GitHub release endpoints.

The previous Zod, TypeScript client, and TypeScript sync packages have been
removed. The committed JSON Schema in the Python package remains the catalog
contract and generates the Pydantic models during builds.

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
bun run sync --format
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

catalog = ModelCatalogClient.from_url(
    "https://raw.githubusercontent.com/example/dbx-model-catalog/main/catalog.json.br"
)

models = catalog.query(
    {"status": "active", "tasks": ["reasoning", "chat"]},
    CatalogQueryOptions(order_by="name", limit=20),
)
```

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
const catalog = await catalogModule.NodeModelCatalogClient({
  schema_version: 11,
  updated_at: "2026-11-03T12:00:00Z",
  models: {},
});

console.log(await catalog.get_size());
```

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
client invocation. In a development checkout, pass `project: "../python"` and
`with: []` to use the local Hatch package instead.
