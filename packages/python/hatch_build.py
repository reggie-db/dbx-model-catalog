from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from shutil import copyfile

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, object]) -> None:
        root = Path(self.root)
        subprocess.run(
            [sys.executable, str(root / "scripts" / "generate_models.py")],
            cwd=self.root,
            check=True,
        )
        if version == "editable" or self.target_name not in {"sdist", "wheel"}:
            return
        workspace = root.parents[1]
        node_package = workspace / "packages" / "node"
        output = root / "dist-node"
        output.mkdir(exist_ok=True)
        stable_artifact = output / "node-client.tgz"
        if node_package.is_dir():
            for artifact in output.glob("*.tgz"):
                artifact.unlink()
            subprocess.run(["bun", "install"], cwd=workspace, check=True)
            subprocess.run(
                ["bun", "run", "generate", "--", self.metadata.version],
                cwd=node_package,
                check=True,
            )
            subprocess.run(
                ["bun", "run", "bundle"], cwd=node_package, check=True
            )
            subprocess.run(
                ["bun", "pm", "pack", "--destination", str(output)],
                cwd=node_package,
                check=True,
            )
            packed = [
                artifact
                for artifact in output.glob("*.tgz")
                if artifact != stable_artifact
            ]
            if len(packed) != 1:
                raise RuntimeError(
                    f"Expected one Node package, found {len(packed)}"
                )
            copyfile(packed[0], stable_artifact)
            packed[0].unlink()
        elif not stable_artifact.is_file():
            raise RuntimeError("Node client artifact is unavailable")
        if self.target_name == "wheel":
            force_include = build_data.setdefault("force_include", {})
            if not isinstance(force_include, dict):
                raise TypeError("Hatch force_include build data must be a mapping")
            force_include[str(stable_artifact)] = (
                "dbx_model_catalog/artifacts/node-client.tgz"
            )
