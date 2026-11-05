# @dbx-tools/dbx-model-catalog

The Node client connects to the Python-owned model catalog contract. It starts a
local Pynect worker by default or connects to a remote Chanx WebSocket server
when a URL is provided.

```ts
import { connectModelCatalog } from "@dbx-tools/dbx-model-catalog";

await using local = await connectModelCatalog();
const matches = await local.client.list({ query: "gpt", limit: 10 });

await using remote = await connectModelCatalog("wss://catalog.example.com");
const catalog = await remote.client.catalog();
```

Pass `{ python: "/path/to/python" }` to select the Python executable used for
the local worker. Generated catalog types are re-exported from this package.
The package does not contain a separate JavaScript schema implementation.

For direct public ingestion without the service client, fetch:
<https://reggie-db.github.io/dbx-model-catalog/catalog.json>.
