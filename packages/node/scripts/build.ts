import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(packageRoot, "dist");
const py = resolve(packageRoot, "py");
const pynectRoot = realpathSync(resolve(packageRoot, "node_modules/pynect"));
const dependencyModules = dirname(pynectRoot);
const pyfigRoot = realpathSync(resolve(dependencyModules, "pyfig"));
const pynectRuntime = realpathSync(resolve(pynectRoot, "dist/js/python-venv.js"));
const undiciEntry = realpathSync(
  resolve(dirname(pyfigRoot), "undici/index.js"),
);
const runtimePaths: BunPlugin = {
  name: "runtime-paths",
  setup(build) {
    build.onLoad({ filter: /python-venv\.js$/ }, async ({ path }) => {
      if (realpathSync(path) !== pynectRuntime) return;
      const source = await Bun.file(path).text();
      const contents = source.replace(
        "return (0, python_script_1.resolvePythonScript)(__dirname, 'pynect_worker.py');",
        "return require('node:url').fileURLToPath(new URL('../py/pynect_worker.py', import.meta.url));",
      );
      if (contents === source) throw new Error("Pynect worker path was not found");
      return { contents, loader: "js" };
    });
    build.onLoad({ filter: /undici\/index\.js$/ }, async ({ path }) => {
      if (realpathSync(path) !== undiciEntry) return;
      const source = await Bun.file(path).text();
      const contents = source.replace(
        "const currentFilename = typeof __filename !== 'undefined' ? __filename : undefined",
        "const currentFilename = undefined",
      );
      if (contents === source) throw new Error("Undici filename capture was not found");
      return { contents, loader: "js" };
    });
  },
};

rmSync(dist, { force: true, recursive: true });
rmSync(py, { force: true, recursive: true });

const result = await Bun.build({
  entrypoints: [
    resolve(packageRoot, "src/cli.ts"),
    resolve(packageRoot, "src/index.ts"),
    resolve(packageRoot, "src/server.ts"),
  ],
  external: ["fs-ext"],
  format: "esm",
  minify: false,
  outdir: dist,
  plugins: [runtimePaths],
  sourcemap: "external",
  splitting: true,
  target: "node",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const rpcResult = await Bun.build({
  entrypoints: [resolve(packageRoot, "src/rpc.ts")],
  format: "esm",
  minify: false,
  outdir: dist,
  sourcemap: "external",
  target: "browser",
});

if (!rpcResult.success) {
  for (const log of rpcResult.logs) console.error(log);
  process.exit(1);
}

chmodSync(resolve(dist, "cli.js"), 0o755);

mkdirSync(py, { recursive: true });
copyFileSync(
  resolve(pynectRoot, "dist/py/pynect_worker.py"),
  resolve(py, "pynect_worker.py"),
);
