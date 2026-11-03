# dbx-model-catalog

Python client and sync library for the Databricks model catalog.

```py
from dbx_model_catalog import ModelCatalogClient

catalog = ModelCatalogClient.from_published()
models = catalog.list()
```

The package includes Pydantic catalog models, JSON and Brotli loading, a
serializable query DSL, source sync clients, and catalog normalization. The
published client caches the compressed normalized dataset for one hour in the
platform-native user cache directory; pass `refresh=True` to replace it. The
normalization pipeline uses DiskCache separately and supports explicit refresh
through `CatalogSync.sync(refresh=True)`.

Builds regenerate the Pydantic models from the committed JSON Schema. A custom
Hatch hook also builds the Pynect-based `@regbo/dbx-model-catalog` npm package
and includes its tarball as a Python build artifact.
