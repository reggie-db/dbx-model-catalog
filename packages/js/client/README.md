# @dbx-tools/dbx-model-catalog

The default Node client loads the JSON catalog and search index directly. It
does not install or start Python, uv, Pynect, or Pyfig.
The package contains public catalog data only. It does not authenticate to a
Databricks workspace or discover customer endpoints.

```ts
import { connectModelCatalog } from "@dbx-tools/dbx-model-catalog";

await using local = await connectModelCatalog();
const matches = await local.client.list({ query: "gpt", limit: 10 });

await using remote = await connectModelCatalog("https://example.com/catalog.json");
const catalog = await remote.client.catalog();
```

Set `DBX_MODEL_CATALOG_PATH` to load a local catalog. The client loads
`search-index.json` from the same directory unless `searchIndexPath` is set.
Generated catalog types are re-exported from the package.

The browser-safe entry point also exports the catalog-owned Zod schemas. Use
these schemas directly in downstream wire contracts instead of recreating the
catalog fields:

```ts
import {
  CatalogModelRecordSchema,
  CatalogStatusSchema,
  type CatalogModelRecord,
} from "@dbx-tools/dbx-model-catalog/browser";

const model: CatalogModelRecord = CatalogModelRecordSchema.parse(value);
const status = CatalogStatusSchema.parse(model.status);
```

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

The `/browser` entry point exports `loadModelCatalog()` and
`createModelCatalogClient()` for browser and worker use. Both use the same
TypeScript filtering and ranked-search implementation as the Node entry point.

Load the public catalog remotely when matching and enriching endpoints that
another client already discovered:

```ts
import {
  enrichLiveModels,
  loadModelCatalogIndex,
} from "@dbx-tools/dbx-model-catalog/browser";

const modelCatalogIndex = await loadModelCatalogIndex();

const enriched = enrichLiveModels(
  modelCatalogIndex,
  liveEndpoints,
  endpoint => [endpoint.name, endpoint.modelServiceName].filter(Boolean),
);
```

The join preserves live records that have no public catalog match. Workspace
discovery remains authoritative when documentation lags. The npm package does
not embed a catalog snapshot; catalog and search data are fetched from the
published schema URL.

The local explorer demo uses the explicit Pynect adapter to connect to the
Python server:

```ts
import { createPynectCatalogClient } from "@dbx-tools/dbx-model-catalog/pynect";

const client = createPynectCatalogClient({ baseUrl: "ws://127.0.0.1:8787" });
const matches = await client.list({ query: "gpt", limit: 10 });
client.close();
```

Install `pynect` and `@chanx-js/client` only when using this optional adapter.
They are not runtime dependencies of the default client.

The current URL is
<https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog/v16/catalog.json>.
Its `updated_at` field records the latest source-fetch timestamp represented by
the catalog.
