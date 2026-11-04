import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = resolve(packageRoot, "../python");
const pythonSource = resolve(pythonRoot, "src");
const schema = resolve(pythonSource, "dbx_model_catalog/schema/model-catalog.schema.json");
const pynect = resolve(
  packageRoot,
  "node_modules/.bin",
  process.platform === "win32" ? "pynect.cmd" : "pynect",
);
const pyproject = readFileSync(resolve(pythonRoot, "pyproject.toml"), "utf8");
const projectVersion = /^version\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1];
const version = process.argv[2] ?? projectVersion;
const { VIRTUAL_ENV: _virtualEnvironment, ...environment } = process.env;

if (!version) throw new Error("Could not determine Python package version");

const output = resolve(packageRoot, "src/generated/dbx-model-catalog-python.ts");
const catalogTypesOutput = resolve(packageRoot, "src/generated/catalog-types.ts");
writeFileSync(
  catalogTypesOutput,
  await compileFromFile(schema, {
    bannerComment: "// Generated from model-catalog.schema.json. Do not edit by hand.",
  }),
);
const sitePackages = spawnSync(
  "uv",
  [
    "run",
    "--project",
    pythonRoot,
    "python",
    "-c",
    "import sysconfig; print(sysconfig.get_paths()['purelib'])",
  ],
  { cwd: packageRoot, encoding: "utf8", env: environment },
);

if (sitePackages.error) throw sitePackages.error;
if (sitePackages.status !== 0) process.exit(sitePackages.status ?? 1);

const codegenEnvironment = {
  ...environment,
  PYTHONPATH: [
    pythonSource,
    sitePackages.stdout.trim(),
    environment.PYTHONPATH,
  ].filter(Boolean).join(delimiter),
};

const result = spawnSync(
  pynect,
  [
    "codegen",
    "generate",
    "--root",
    pythonSource,
    "--module",
    "client=dbx_model_catalog.node",
    "--module",
    "types=dbx_model_catalog._generated.node_types",
    "--class-name",
    "DbxModelCatalogPython",
    "--no-project",
    "--with",
    `dbx-model-catalog>=${version}`,
    "--out",
    output,
    "--validate-pydantic",
    "--no-auto-close",
  ],
  { cwd: packageRoot, env: codegenEnvironment, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
