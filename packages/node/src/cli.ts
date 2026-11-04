#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detectPackageManager, installPackage } from "@antfu/install-pkg";
import type * as Fireargs from "fireargs";
import type * as Zod from "zod";
import { DbxModelCatalogPython, type CreateVenvOptions } from "./index.js";

type JsonObject = Record<string, unknown>;

const modelStatuses = [
  "active",
  "preview",
  "alpha",
  "beta",
  "legacy",
  "deprecated",
  "retired",
] as const;
const modelTypes = [
  "chat",
  "image",
  "video",
  "embedding",
  "reranking",
  "decision",
  "transcription",
  "speech",
  "realtime",
  "extraction",
  "audio",
] as const;
const capabilityNames = [
  "attachments",
  "tools",
  "structured-output",
  "temperature",
  "interleaved-reasoning",
  "web-search",
  "reasoning",
] as const;

export interface LookupInput {
  readonly query?: string | undefined;
  readonly expression?: JsonObject | undefined;
  readonly id?: readonly string[] | undefined;
  readonly status?: readonly (typeof modelStatuses)[number][] | undefined;
  readonly type?: readonly (typeof modelTypes)[number][] | undefined;
  readonly publisher?: readonly string[] | undefined;
  readonly family?: readonly string[] | undefined;
  readonly license?: readonly string[] | undefined;
  readonly task?: readonly string[] | undefined;
  readonly useCase?: readonly string[] | undefined;
  readonly inputModality?: readonly string[] | undefined;
  readonly outputModality?: readonly string[] | undefined;
  readonly capability?: readonly (typeof capabilityNames)[number][] | undefined;
  readonly withoutCapability?: readonly (typeof capabilityNames)[number][] | undefined;
  readonly openWeights?: boolean | undefined;
  readonly closedWeights?: boolean | undefined;
  readonly minContext?: number | undefined;
  readonly maxContext?: number | undefined;
  readonly releasedAfter?: string | undefined;
  readonly releasedBefore?: string | undefined;
  readonly updatedAfter?: string | undefined;
  readonly updatedBefore?: string | undefined;
  readonly caseSensitive?: boolean | undefined;
  readonly maxDepth?: number | undefined;
  readonly orderBy?: string | undefined;
  readonly direction?: "asc" | "desc" | undefined;
  readonly limit?: number | undefined;
  readonly format?: boolean | undefined;
}

export interface LookupQuery {
  readonly expression: JsonObject;
  readonly options: JsonObject;
}

const cliDependencySpecifiers: string[] = [
  "commander@^14.0.3",
  "fireargs@^0.6.2",
  "zod@^4.6.7",
];
const fireargsPackageName = "fireargs";
const zodPackageName = "zod";
const manifest = createRequire(import.meta.url)("../package.json") as {
  version?: unknown;
};
if (typeof manifest.version !== "string") {
  throw new TypeError("The package manifest does not contain a string version.");
}
const packageVersion = manifest.version;
const pythonSyncRequirement = `dbx-model-catalog[sync]>=${packageVersion}`;
const cliDependencyRoot = path.join(cliCacheDirectory(), packageVersion);
const localPythonProject = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../python",
);
const pythonRuntimeOptions: CreateVenvOptions = existsSync(
  path.join(localPythonProject, "pyproject.toml"),
)
  ? { with: [], withEditable: [`${localPythonProject}[sync]`] }
  : { with: [pythonSyncRequirement] };

/** Run the dbx-model-catalog command-line interface. */
export async function main(argv: string[] = process.argv): Promise<void> {
  const { f, z } = await loadCliDependencies();
  const jsonObject = z.record(z.string(), z.unknown());
  const jsonRecords = z.array(jsonObject);
  const sync = f
    .command({
      name: "sync",
      description: "Fetch the model sources and print the model catalog.",
    })
    .input(z.object({
      raw: f.option({ short: "r" }).schema(
        z.boolean().default(false).describe(
          "Print complete source payloads without catalog normalization.",
        ),
      ),
      format: f.option({ short: "f" }).schema(
        z.boolean().default(false).describe("Indent JSON output with two spaces."),
      ),
      refresh: z.boolean().default(false).describe(
        "Rebuild the catalog and replace all cached source data.",
      ),
    }))
    .output(jsonObject)
    .render((output, { input }) => JSON.stringify(output, null, input.format ? 2 : undefined))
    .handler(async ({ raw, refresh }) => {
      await using python = new DbxModelCatalogPython(pythonRuntimeOptions);
      const catalogModule = await python.client;
      const catalogSync = await catalogModule.NodeCatalogSync();
      return catalogSync.sync(raw, refresh);
    });

  const lookup = f
    .command({
      name: "lookup",
      description: "Find catalog models using typed filters or a query expression.",
    })
    .input(z.object({
      query: f.argument().schema(
        z.string().min(1).optional().describe(
          "Text matched against model IDs, names, aliases, and descriptions.",
        ),
      ),
      expression: f.option({ parse: parseJsonObject }).schema(
        jsonObject.optional().describe(
          "JSON query DSL expression combined with the typed filters.",
        ),
      ),
      id: z.array(z.string()).optional().describe("Exact model IDs to include."),
      status: z.array(z.enum(modelStatuses)).optional().describe(
        "Lifecycle statuses to include.",
      ),
      type: z.array(z.enum(modelTypes)).optional().describe("Model types to include."),
      publisher: z.array(z.string()).optional().describe("Publishers to include."),
      family: z.array(z.string()).optional().describe("Model families to include."),
      license: z.array(z.string()).optional().describe("Licenses to include."),
      task: z.array(z.string()).optional().describe(
        "Required tasks; every supplied task must be present.",
      ),
      useCase: z.array(z.string()).optional().describe(
        "Required use cases; every supplied use case must be present.",
      ),
      inputModality: z.array(z.string()).optional().describe(
        "Required input modalities.",
      ),
      outputModality: z.array(z.string()).optional().describe(
        "Required output modalities.",
      ),
      capability: z.array(z.enum(capabilityNames)).optional().describe(
        "Required supported capabilities.",
      ),
      withoutCapability: z.array(z.enum(capabilityNames)).optional().describe(
        "Capabilities that must be explicitly unsupported.",
      ),
      openWeights: f.option({ conflicts: "closedWeights" }).schema(
        z.boolean().default(false).describe("Include only open-weight models."),
      ),
      closedWeights: f.option({ conflicts: "openWeights" }).schema(
        z.boolean().default(false).describe("Include only closed-weight models."),
      ),
      minContext: z.number().int().nonnegative().optional().describe(
        "Minimum context window in tokens.",
      ),
      maxContext: z.number().int().nonnegative().optional().describe(
        "Maximum context window in tokens.",
      ),
      releasedAfter: z.iso.date().optional().describe(
        "Earliest release date, inclusive (YYYY-MM-DD).",
      ),
      releasedBefore: z.iso.date().optional().describe(
        "Latest release date, inclusive (YYYY-MM-DD).",
      ),
      updatedAfter: z.iso.date().optional().describe(
        "Earliest metadata update date, inclusive (YYYY-MM-DD).",
      ),
      updatedBefore: z.iso.date().optional().describe(
        "Latest metadata update date, inclusive (YYYY-MM-DD).",
      ),
      caseSensitive: z.boolean().default(false).describe(
        "Use case-sensitive string matching and sorting.",
      ),
      maxDepth: z.number().int().min(0).max(10).default(3).describe(
        "Maximum nested query depth.",
      ),
      orderBy: z.string().default("name").describe(
        "Catalog field used to sort results.",
      ),
      direction: z.enum(["asc", "desc"]).default("asc").describe(
        "Sort direction.",
      ),
      limit: f.option({ short: "l" }).schema(
        z.number().int().nonnegative().default(20).describe(
          "Maximum number of matching models.",
        ),
      ),
      format: f.option({ short: "f" }).schema(
        z.boolean().default(false).describe("Indent JSON output with two spaces."),
      ),
      refresh: z.boolean().default(false).describe(
        "Rebuild the catalog and replace all cached source data.",
      ),
    }))
    .output(jsonRecords)
    .render((output, { input }) => JSON.stringify(output, null, input.format ? 2 : undefined))
    .handler(async input => {
      const query = buildLookupQuery(input);
      await using python = new DbxModelCatalogPython(pythonRuntimeOptions);
      const catalogModule = await python.client;
      const catalogSync = await catalogModule.NodeCatalogSync();
      const catalog = await catalogSync.sync(false, input.refresh);
      const catalogClient = await catalogModule.NodeModelCatalogClient(catalog as never);
      return [...await catalogClient.query(query.expression, query.options)] as unknown as JsonObject[];
    });

  const program = f.program({
    name: "dbx-model-catalog",
    description: "Synchronize and query the Databricks model catalog through Python.",
    version: packageVersion,
  }).router({ lookup, sync });

  await program.parseAsync(argv);
}

export function buildLookupQuery(input: LookupInput): LookupQuery {
  const clauses: JsonObject[] = [];
  if (input.expression) clauses.push(input.expression);
  if (input.query) clauses.push(textSearchExpression(input.query));
  addScalarFilter(clauses, "id", input.id);
  addScalarFilter(clauses, "status", input.status);
  addScalarFilter(clauses, "type", input.type);
  addScalarFilter(clauses, "publisher", input.publisher);
  addScalarFilter(clauses, "family", input.family);
  addScalarFilter(clauses, "license", input.license);
  addContainsFilters(clauses, "tasks", input.task);
  addContainsFilters(clauses, "use_cases", input.useCase);
  addNestedContainsFilters(clauses, "modalities", "input", input.inputModality);
  addNestedContainsFilters(clauses, "modalities", "output", input.outputModality);
  addCapabilityFilters(clauses, input.capability, true);
  addCapabilityFilters(clauses, input.withoutCapability, false);
  if (input.openWeights) clauses.push({ open_weights: { $eq: true } });
  if (input.closedWeights) clauses.push({ open_weights: { $eq: false } });
  const contextRange = rangeExpression(input.minContext, input.maxContext);
  if (contextRange) clauses.push({ limits: { context: contextRange } });
  const releaseRange = rangeExpression(input.releasedAfter, input.releasedBefore);
  if (releaseRange) clauses.push({ release_date: releaseRange });
  const updatedRange = rangeExpression(input.updatedAfter, input.updatedBefore);
  if (updatedRange) clauses.push({ last_updated: updatedRange });

  return {
    expression: clauses.length === 0
      ? {}
      : clauses.length === 1
        ? clauses[0]!
        : { $and: clauses },
    options: {
      caseSensitive: input.caseSensitive ?? false,
      maxDepth: input.maxDepth ?? 3,
      orderBy: {
        field: input.orderBy ?? "name",
        direction: input.direction ?? "asc",
      },
      limit: input.limit ?? 20,
    },
  };
}

function parseJsonObject(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonObject(parsed)) throw new TypeError("Expected a JSON object.");
  return parsed;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textSearchExpression(query: string): JsonObject {
  return {
    $or: ["id", "name", "aliases", "description"].map(field => ({
      [field]: { $contains: query },
    })),
  };
}

function addScalarFilter(
  clauses: JsonObject[],
  field: string,
  values: readonly unknown[] | undefined,
): void {
  if (!values || values.length === 0) return;
  clauses.push({
    [field]: values.length === 1 ? { $eq: values[0] } : { $in: values },
  });
}

function addContainsFilters(
  clauses: JsonObject[],
  field: string,
  values: readonly unknown[] | undefined,
): void {
  for (const value of values ?? []) clauses.push({ [field]: { $contains: value } });
}

function addNestedContainsFilters(
  clauses: JsonObject[],
  parent: string,
  field: string,
  values: readonly unknown[] | undefined,
): void {
  for (const value of values ?? []) {
    clauses.push({ [parent]: { [field]: { $contains: value } } });
  }
}

function addCapabilityFilters(
  clauses: JsonObject[],
  capabilities: readonly (typeof capabilityNames)[number][] | undefined,
  supported: boolean,
): void {
  for (const capability of capabilities ?? []) {
    const field = capability.replaceAll("-", "_");
    clauses.push({
      capabilities: {
        [field]: capability === "reasoning"
          ? { [supported ? "$ne" : "$eq"]: null }
          : { $eq: supported },
      },
    });
  }
}

function rangeExpression(
  minimum: number | string | undefined,
  maximum: number | string | undefined,
): JsonObject | undefined {
  if (minimum === undefined && maximum === undefined) return undefined;
  return {
    ...(minimum === undefined ? {} : { $gte: minimum }),
    ...(maximum === undefined ? {} : { $lte: maximum }),
  };
}

async function loadCliDependencies(): Promise<{
  f: typeof Fireargs.f;
  z: typeof Zod.z;
}> {
  await mkdir(cliDependencyRoot, { recursive: true });
  const cliManifest = path.join(cliDependencyRoot, "package.json");
  await writeFile(
    cliManifest,
    `${JSON.stringify({ name: "dbx-model-catalog-cli", private: true, type: "module" }, null, 2)}\n`,
  );
  const packageManager = await detectPackageManager(process.cwd());
  await installPackage(cliDependencySpecifiers, {
    additionalArgs: agent => noSaveArguments(agent),
    cwd: cliDependencyRoot,
    ...(packageManager ? { packageManager } : {}),
    preferOffline: true,
    silent: true,
  });
  const cliRequire = createRequire(cliManifest);
  const [{ f }, { z }] = await Promise.all([
    import(pathToFileURL(cliRequire.resolve(fireargsPackageName)).href) as Promise<typeof Fireargs>,
    import(pathToFileURL(cliRequire.resolve(zodPackageName)).href) as Promise<typeof Zod>,
  ]);
  return { f, z };
}

function cliCacheDirectory(): string {
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
      "dbx-model-catalog",
      "cli",
    );
  }
  return path.join(
    process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"),
    "dbx-model-catalog",
    "cli",
  );
}

function noSaveArguments(agent: string): string[] {
  if (agent === "bun") return ["--no-save"];
  if (agent === "npm") return ["--no-save", "--package-lock=false"];
  return [];
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(realpathSync(invokedPath)).href === import.meta.url) {
  await main();
}
