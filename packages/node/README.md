# @regbo/dbx-model-catalog

Generated Node and Bun bridge for the Python `dbx-model-catalog` package.

Client generation uses Pynect `^0.8.2` from npm. Pynect resolves compatible
Pyfig, Loqkit, and Optionkit packages through its published dependencies; no
toolkit package is linked from GitHub or a vendored tarball.

The built client bundles the installed Pynect, Pyfig, and Loqkit JavaScript and
copies the Pynect Python worker. At runtime Pyfig resolves or provisions `uv`
and Python, then Pynect launches the Python package through `uv run`. The client
defaults uv and Python provisioning to `releases.astral.sh`, so it does not hit
GitHub release endpoints. Existing compatible uv and Python installations are
reused without downloading either tool.

## CLI

The package publishes a Node-only `dbx-model-catalog` executable. It lazily
installs the optional Fireargs parser when first invoked, then runs the Python
sync implementation through Pynect with the matching `dbx-model-catalog[sync]`
version.

```sh
dbx-model-catalog sync
dbx-model-catalog sync --format
dbx-model-catalog sync --raw --format
dbx-model-catalog lookup gpt --status active preview --task reasoning
dbx-model-catalog lookup --type embedding --input-modality text --limit 10 --format
dbx-model-catalog lookup --capability tools structured-output --min-context 128000
dbx-model-catalog lookup gpt --refresh
```

`--raw` prints the complete source payloads before normalization. `--format`
indents JSON with two spaces.

`lookup` synchronizes the normalized catalog, then delegates filtering and
sorting to the Python query engine. It supports typed filters for IDs,
lifecycle status, model type, publishers, families, licenses, tasks, use cases,
modalities, capabilities, open weights, context limits, release/update dates,
sorting, and result limits. Pass `--expression '{...}'` to combine a raw query
DSL expression with the typed filters.

Normalized catalogs use the Python library's DiskCache-backed, one-hour cache
under the system temporary directory. Warm `lookup` and normalized `sync`
commands do not fetch or parse sources. Pass `--refresh` to evict and rebuild
the complete catalog and source caches.

For Hugging Face-backed sources, set `HF_TOKEN` in the environment or in the
nearest `.env` found by walking upward from the command's current directory.
The loader reads only `HF_TOKEN` and never replaces an exported value.

In the monorepo checkout, the CLI automatically layers the editable
`packages/python[sync]` project. The packed npm CLI instead requests
`dbx-model-catalog[sync]>=<matching version>` from uv.
