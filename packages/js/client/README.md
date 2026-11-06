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

The npm artifact includes the Python service source. Pynect uses uv to
provision its isolated environment on the first local connection. Generated
catalog types are re-exported from this package. The package does not contain a
separate JavaScript schema implementation.

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

The current URL is
<https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/v15/catalog.json>.
Its `updated_at` field records the latest source-fetch timestamp represented by
the catalog.
