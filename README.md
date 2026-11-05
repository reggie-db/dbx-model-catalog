# dbx-model-catalog

Python owns the catalog schema, Pydantic models, filtering, and synchronization.
Chanx exposes the read-only catalog service. Pynect generates the TypeScript
contract used by both the Node client and browser.

Text search is ranked by the Python service with RapidFuzz. The browser keeps
categorical and numeric filtering local after receiving the relevance-ordered
matches.

Catalog records include openable source links for model metadata, pricing,
notices, rankings, benchmarks, and derived use cases where upstream provenance
is available.

## Layout

- `packages/py/common`: shared Pydantic models and catalog read/filter service
- `packages/py/server`: Chanx WebSocket server and Pynect worker configuration
- `packages/py/sync`: source ingestion and catalog publishing
- `packages/js/common`: generated Pynect contract plus a small shared wrapper
- `packages/js/node`: thin local IPC or remote WebSocket client and Bun CLI
- `packages/js/sync`: Bun entry point for the heavier Python sync package
- `packages/js/web`: React catalog browser using the remote WebSocket client

Generated TypeScript is written to `packages/js/common/src/_generated`.
Handwritten TypeScript does not duplicate the Python API models.

## Setup and checks

```sh
bun install
bun run generate
bun run check
```

The root is a virtual uv workspace. Each Python package uses Hatchling, and
server/sync declare common as a workspace dependency:

```sh
uv build --package dbx-model-catalog
```

The root Bun build regenerates the Pynect client, builds Node and the browser,
then builds the Python distribution:

```sh
bun run build
```

## Node client

Without a URL, the Bun CLI starts the Python Pynect worker and connects over
local IPC. With `--url`, it connects to an already-running Chanx server over
WebSocket.

```sh
bun run chanx-model-catalog models gpt
bun run chanx-model-catalog model-feed gpt
bun run chanx-model-catalog models gpt --url ws://127.0.0.1:8787
```

Library use follows the same rule:

```ts
import { connectModelCatalog } from '@regbo/dbx-model-catalog';

await using session = await connectModelCatalog(process.env.CATALOG_URL);
const models = await session.client.list({ status: ['active'], limit: 10 });
```

## Server and browser

```sh
bun run serve
```

This builds the browser and starts the Python server at
`http://127.0.0.1:8787`. The browser connects to the same origin over
WebSocket. The serve script points the server at the same local `catalog.json`
that the browser downloads. GitHub Pages cannot host the server, so the
deployed static build reads its colocated catalog directly instead.

The server and local IPC worker load the published catalog by default. Set
`DBX_MODEL_CATALOG_PATH` only when an explicit local catalog artifact is needed.

The server also exposes `/health`, `/asyncapi`, and `/asyncapi.json`.

## Catalog synchronization

Synchronization is separate from all clients. The Bun command invokes the
Python sync package; no Python CLI entry point is published.

```sh
bun run sync
bun run sync --refresh
bun run sync --output-directory packages/js/web
```

Hugging Face-backed sources use `HF_TOKEN` from the environment. The sync
package also reads the nearest ignored `.env` file when the variable is not
already set.
