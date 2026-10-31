# dbx-model-catalog

Typed Python client for the JSON or Brotli-compressed Databricks model catalog.
The Pydantic models are generated from the same Zod-owned JSON Schema as the
TypeScript client.

```py
from typing import assert_type

from dbx_model_catalog import (
    CatalogModelRecord,
    CatalogQueryOptions,
    ModelCatalogClient,
)

catalog = ModelCatalogClient.from_url(
    "https://raw.githubusercontent.com/example/dbx-model-catalog/main/catalog.json.br"
)
models = catalog.query(
    {
        "$and": [
            {"status": "active"},
            {"tasks": ["reasoning", "chat"]},
            {"rankings": {"metric": "rating", "rank": {"$lte": 10}}},
        ]
    },
    CatalogQueryOptions(order_by="name", limit=20),
)

assert_type(models, list[CatalogModelRecord])
```

`ModelCatalogClient.from_url()` accepts `fetch: Callable[[str], bytes]` and
`decode: Callable[[bytes, Literal["json", "brotli"]], str]` overrides. Query
objects support `$and`, `$or`, `$not`, comparisons, text operators, sorting,
limits, recursive arrays, and nested arrays of objects. Query results always
contain the complete `CatalogModelRecord`.
