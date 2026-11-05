import { copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { BunPlugin } from "bun";
import tailwind from "bun-plugin-tailwind";

const root = resolve(import.meta.dir, "..");
const output = resolve(root, "dist");
const require = createRequire(import.meta.url);
const reactEntries = new Map(
  ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"].map(
    specifier => [specifier, require.resolve(specifier)],
  ),
);
const dedupeReact: BunPlugin = {
  name: "dedupe-react",
  setup(build) {
    build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => {
      const resolved = reactEntries.get(path);
      return resolved ? { path: resolved } : undefined;
    });
  },
};

await rm(output, { force: true, recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "index.html")],
  minify: true,
  outdir: output,
  plugins: [tailwind, dedupeReact],
  target: "browser",
  tsconfig: resolve(root, "tsconfig.json"),
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await mkdir(output, { recursive: true });
await Promise.all(
  [".nojekyll", "catalog.json", "catalog.sqlite", "favicon.svg", "search-index.json"].map(file =>
    copyFile(resolve(root, file), resolve(output, file)),
  ),
);
