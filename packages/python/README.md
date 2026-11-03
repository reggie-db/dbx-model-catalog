# dbx-model-catalog

Python client and sync library for the Databricks model catalog.

```py
from dbx_model_catalog import ModelCatalogClient

catalog = ModelCatalogClient.from_url("https://example.com/catalog.json.br")
models = catalog.list()
```

The package includes Pydantic catalog models, JSON and Brotli loading, a
serializable query DSL, source sync clients, and catalog normalization. The
normalized catalog uses DiskCache for one-hour persistent caching and supports
explicit refresh through `CatalogSync.sync(refresh=True)`.

Builds regenerate the Pydantic models from the committed JSON Schema. A custom
Hatch hook also builds the Pynect-based `@regbo/dbx-model-catalog` npm package
and includes its tarball as a Python build artifact.
