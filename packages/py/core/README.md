# dbx-model-catalog

This Python package contains the Pydantic schema and local read, filter, query,
and search client for the Databricks model catalog.

Load the public catalog:

```py
from dbx_model_catalog import ModelCatalogClient

catalog = ModelCatalogClient.from_published()
models = catalog.list()
active = catalog.filter({"status": ["active"]})
ranked = catalog.search("claude reasoning", limit=5)
```

`from_published()` downloads
<https://raw.githubusercontent.com/reggie-db/dbx-model-catalog/main/packages/js/web/catalog.json>
and caches the
payload for one hour in the platform-native user cache directory. Pass
`refresh=True` to replace the cached value or `cache_ttl` to change its
lifetime.

Load explicit data when the published endpoint is not appropriate:

```py
from pathlib import Path
from dbx_model_catalog import ModelCatalogClient

local = ModelCatalogClient.from_json(Path("catalog.json").read_bytes())
remote = ModelCatalogClient.from_url("https://example.com/catalog.json")
```

The client also supports Brotli payloads through `from_brotli()`. Search builds
one in-memory index for the loaded catalog and uses RapidFuzz across model
identity, publisher, capabilities, tasks, use cases, modalities, availability,
leaderboards, benchmarks, and notices. Relevance is combined with independent
version, freshness, lifecycle, leaderboard, and benchmark scores. Query and
filter operations return standard typed `CatalogModelRecord` lists.
