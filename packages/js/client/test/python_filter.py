import json
import sys
from pathlib import Path

from dbx_model_catalog import ModelCatalogClient


catalog_path = Path(sys.argv[1])
filters = json.load(sys.stdin)
client = ModelCatalogClient.from_json(catalog_path.read_bytes())
results = [
    [record.model_dump(mode="json") for record in client.filter(case)]
    for case in filters
]
json.dump(results, sys.stdout, separators=(",", ":"))
