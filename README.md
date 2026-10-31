# dbx-model-catalog

A normalized catalog that matches model metadata and benchmark results from:

- [models.dev](https://models.dev/)
- [modelparams.dev](https://modelparams.dev/)
- [Arena Leaderboard](https://arena.ai/leaderboard)
- [LiveBench](https://livebench.ai/)
- Databricks Foundation Model APIs

The workflow reconciles model identities across sources and produces a
queryable catalog of normalized model capabilities, rankings,
availability, pricing, lifecycle state, and Databricks endpoint mappings.

## Workspace

This is a small Bun and TypeScript monorepo:

- `packages/common`: shared source and result contracts
- `packages/clients`: TypeScript client for loading and querying the catalog
- `packages/python`: uv-managed Python client generated from the shared schema
- `packages/sync`: upstream clients, source-specific sync services, and the
  aggregate sync runner
- `packages/database`: reserved for normalized database construction

The sync package reads the five external sources and validates each source with
a loose Zod schema, so additional upstream fields are retained. Integer-like
fields are converted to numbers, and source dates are parsed with `chrono-node`.
The resulting output is validated against the normalized schema in
`packages/common`.

```sh
bun install
bun run check
bun run sync
bun run sync --format
bun run sync --raw
```

`bun run sync` prints the normalized common catalog as minified JSON. Add
`--format` for two-space indentation, or use `--raw` to print the complete
source payloads before normalization. The flags can be combined. Databricks
model service names such as `system.ai.gpt-5-6-sol`, serving endpoints such as
`databricks-gpt-5-6-sol`, and source model IDs are retained as aliases of one
Databricks-rooted model record. The serving endpoint is the catalog object key
when it is available; that key is not repeated as an inner `id` or alias. Other
sources only enrich models already present in Databricks.

Each normalized record describes one Databricks model. The public contract is
flat and uses snake_case. The catalog object is keyed by the Databricks endpoint
ID, so the ID is not repeated inside the model or its aliases. A record contains
identity, lifecycle dates, modalities, capabilities, token limits, tasks, use
cases, cloud availability, Databricks prices, notices, rankings, and benchmarks.

```json
{
  "schema_version": 11,
  "updated_at": "2026-10-31T12:00:00.000Z",
  "models": {
    "databricks-model-id": {
      "name": "Model name",
      "description": "Model description",
      "aliases": ["system.ai.model-id"],
      "type": "chat",
      "status": "active",
      "modalities": { "input": ["text"], "output": ["text"] },
      "capabilities": { "web_search": false },
      "tasks": [],
      "use_cases": [],
      "availability": {},
      "price": {},
      "average_price": {},
      "notices": [],
      "rankings": [],
      "benchmarks": []
    }
  }
}
```

Details shared across cloud providers appear once. `availability` and `price`
are keyed directly by `aws`, `azure`, and `gcp`; `average_price` contains the
cross-provider average. Only Databricks pricing is included. External inference
provider prices remain available only in raw sync output. Request parameters
also remain raw because client libraries handle them; modelparams.dev is used to
derive normalized capabilities such as reasoning controls.

Competitive leaderboard results are exposed as `rankings`. Task-suite results
are exposed separately as `benchmarks`. The normalized records omit source,
dataset, URL, and parameter metadata.

Source reads are cached for one hour in per-client, file-locked stores under
the operating system temp directory at `dbx-model-catalog/<client>.json`.

The common Zod contract includes descriptions for every normalized field and
enumerates catalog-owned vocabularies such as model types, lifecycle states,
cloud providers, serving modes, price units, ranking metrics, and reasoning
effort. It can be converted directly with
`z.toJSONSchema(ModelCatalogSchema)` for JSON Schema or OpenAPI tooling.

## Client

`@dbx-model-catalog/clients` loads a published minified JSON or Brotli-compressed
JSON catalog, validates it with `ModelCatalogSchema`, and returns typed model
records. Browser and Bun runtimes use native `fetch`, `DecompressionStream`, and
`TextDecoder`. Other runtimes can inject compatible fetch and payload-decoder
functions.

```ts
import { ModelCatalogClient } from "@dbx-model-catalog/clients";

const catalog = await ModelCatalogClient.fromUrl(
  "https://raw.githubusercontent.com/example/dbx-model-catalog/main/catalog.json.br",
);

const models = catalog.query(
  {
    $and: [
      { status: { $eq: "active" } },
      { name: { $contains: "gpt" } },
      { $not: { name: { $contains: "preview" } } },
    ],
  },
  {
    orderBy: { field: "name", direction: "asc" },
    limit: 20,
  },
);
```

`query()` uses the `@mcabreradev/filter` expression DSL, including `$and`,
`$or`, `$not`, comparisons, string matching, array operators, sorting, and
limits. Array fields automatically match any element. A single value and a
list of alternatives use the same semantics, and nested predicates on arrays
of objects must match within the same element:

```ts
const models = catalog.query({
  tasks: ["reasoning", "chat"],
  rankings: { metric: "rating", rank: { $lte: 10 } },
});
```

For arbitrary computed predicates, pass a typed callback:

```ts
const models = catalog.query(
  model =>
    model.status === "active" &&
    model.capabilities.reasoning?.supported === true &&
    model.rankings.some(
      ranking => ranking.metric === "rating" && ranking.rank <= 10,
    ),
  {
    orderBy: { field: "name", direction: "asc" },
    limit: 20,
  },
);
```

The callback parameter is inferred as `CatalogModelRecord`, and `query()`
always returns `CatalogModelRecord[]`. Filtering and sorting never project or
reshape a record. Zod validates the downloaded catalog before any query runs,
so every returned model retains the complete validated model shape.

Object DSL queries can be serialized for URLs, files, or storage. The parser
uses Zod to reject functions, unknown catalog fields, unknown operators,
invalid operands, and unknown sort paths before the query is executed:

```ts
import {
  parseCatalogQuery,
  serializeCatalogQuery,
  type SerializableCatalogQuery,
} from "@dbx-model-catalog/clients";

const query = {
  expression: {
    $and: [
      { status: { $eq: "active" } },
      { name: { $contains: "gpt" } },
      {
        capabilities: {
          web_search: { $eq: false },
          reasoning: { effort: { $contains: "high" } },
        },
      },
      { rankings: { metric: "rating", rank: { $lte: 10 } } },
    ],
  },
  options: {
    orderBy: { field: "name", direction: "asc" },
    limit: 20,
  },
} satisfies SerializableCatalogQuery;

const encoded = serializeCatalogQuery(query);
const decoded = parseCatalogQuery(encoded);
const models = catalog.query(decoded.expression, decoded.options);
```

Typed callback predicates can use arbitrary TypeScript, but functions cannot be
represented in JSON and therefore cannot be serialized.

PythonMonkey can supply Python-backed I/O and Brotli decoding without requiring
browser globals:

```ts
const catalog = await ModelCatalogClient.fromBrotli(compressedBytes, {
  decode: pythonBrotliJsonDecoder,
});
```

## Python Client

The `dbx-model-catalog` Python package is a native Pydantic client. It uses the
same JSON Schema generated from the Zod contract, loads JSON or Brotli bytes,
accepts injected fetch and decoder functions, and returns complete typed
`CatalogModelRecord` values.

```sh
uv sync
```

```py
from typing import assert_type

from dbx_model_catalog import (
    CatalogModelRecord,
    CatalogQueryOptions,
    ModelCatalogClient,
)

catalog = ModelCatalogClient.from_url(
    "https://raw.githubusercontent.com/example/dbx-model-catalog/main/catalog.json.br",
)

models = catalog.query(
    {
        "$and": [
            {"status": "active"},
            {"tasks": ["reasoning", "chat"]},
            {"capabilities": {"reasoning": {"effort": "high"}}},
            {"rankings": {"metric": "rating", "rank": {"$lte": 10}}},
        ]
    },
    CatalogQueryOptions(
        order_by={"field": "name", "direction": "asc"},
        limit=20,
    ),
)

assert_type(models, list[CatalogModelRecord])
print(models[0].capabilities.reasoning)
```

An injected fetch function returns bytes, which keeps the client usable with
custom HTTP stacks, tests, and hosted runtimes:

```py
catalog = ModelCatalogClient.from_url(url, fetch=lambda requested_url: payload)
```

Serializable queries use the same camel-case JSON option names as the
TypeScript client while Python construction accepts snake-case field names:

```py
from dbx_model_catalog import (
    CatalogQueryOptions,
    SerializableCatalogQuery,
    parse_catalog_query,
    serialize_catalog_query,
)

query = SerializableCatalogQuery(
    expression={"tasks": ["reasoning", "chat"]},
    options=CatalogQueryOptions(order_by="name", limit=20),
)
encoded = serialize_catalog_query(query)
decoded = parse_catalog_query(encoded)
models = catalog.query(decoded.expression, decoded.options)
```

`bun run schema` exports the Zod contract to the schema vendored in the Python
package and regenerates its Pydantic models. `bun run sync` runs that step
before fetching catalog data. The generated schema and models are committed,
and the Hatchling build hook regenerates the Pydantic module during `uv build`
so published artifacts cannot drift from the vendored contract.

LMArena data comes from the current `lmarena-ai/leaderboard-dataset` on Hugging
Face; the client discovers and reads every latest leaderboard configuration
with `@huggingface/hub` and `hyparquet`. LiveBench data comes from the official
`LiveBench/livebench.github.io` leaderboard repository; the client discovers
the newest complete dated release and computes the same category-balanced
overall score used by the leaderboard. The Databricks client reads supported
models, scoring, reasoning, native web search, retirement policy, and pricing
documentation for AWS, Azure, and GCP. Prices include published DBU rates plus
cloud-provider-specific default-region USD-per-DBU and computed USD rates before
normalization.
