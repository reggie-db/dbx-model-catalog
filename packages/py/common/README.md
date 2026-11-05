# dbx-model-catalog

Shared Pydantic models and local read/filter service for the Databricks model
catalog.

```py
from dbx_model_catalog import ModelCatalogClient

catalog = ModelCatalogClient.from_published()
models = catalog.list()
ranked = catalog.search("claude 5-6", limit=5)
```

The package includes ordinary source-controlled Pydantic catalog models, JSON
and Brotli loading, and a serializable query DSL. The
published client caches the compressed normalized dataset for one hour in the
platform-native user cache directory; pass `refresh=True` to replace it.

`search()` uses RapidFuzz across model identities, publishers, capabilities,
tasks, use cases, modalities, availability, rankings, benchmarks, and notices.
It breaks relevance ties with lifecycle state, parsed version proximity,
aggregate overall leaderboard rank, release date, and stable model identity.
`filter({"query": ...})` uses the same ranking and returns ordinary model
records in relevance order.
