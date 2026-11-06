# @dbx-tools/dbx-model-catalog

The Node client connects to the Python-owned model catalog contract. It starts
a bundled Python worker by default or connects to a remote WebSocket server
when a URL is provided.

```ts
import { connectModelCatalog } from "@dbx-tools/dbx-model-catalog";

await using local = await connectModelCatalog();
const matches = await local.client.list({ query: "gpt", limit: 10 });

await using remote = await connectModelCatalog("wss://catalog.example.com");
const catalog = await remote.client.catalog();
```

The npm artifact includes the Python service source. On the first local
connection, the client uses uv to provision an isolated environment for the
worker. Generated catalog types are re-exported from this package. The package
does not contain a separate JavaScript schema implementation.

The worker is only required by the local service-style Node API. It loads and
validates the Python-owned contract, applies catalog filters, and runs ranked
search. It is not required to read the published JSON artifacts.

For direct public ingestion without the service client, use the exported URL
for the schema this package was generated against:

```ts
import {
  PUBLISHED_CATALOG_INDEX_URL,
  PUBLISHED_CATALOG_URL,
} from "@dbx-tools/dbx-model-catalog/browser";

const catalog = await fetch(PUBLISHED_CATALOG_URL).then(response => response.json());
const registry = await fetch(PUBLISHED_CATALOG_INDEX_URL).then(response => response.json());
```

The `/browser` entry point never starts a local worker. Its
`createCatalogClient()` function connects to an existing WebSocket server when
that service API is wanted. A static browser application can instead fetch the
exported catalog and search-index URLs and perform its own search, filtering,
and sorting entirely in the browser.

The current URL is
<https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/v15/catalog.json>.
Its `updated_at` field records the latest source-fetch timestamp represented by
the catalog.
