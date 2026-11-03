import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { buildLookupQuery } from "../src/cli.ts";

const cliCache = mkdtempSync(path.join(tmpdir(), "dbx-model-catalog-cli-test-"));

describe("CLI", () => {
  test("publishes the sync command", async () => {
    const result = await runCli(["sync", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Fetch the model sources");
    expect(result.stdout).toContain("--raw");
    expect(result.stdout).toContain("--format");
    expect(result.stdout).toContain("--refresh");
    expect(existsSync(path.join(
      cliCache,
      "dbx-model-catalog",
      "cli",
      "0.1.0",
      "node_modules",
      "fireargs",
    ))).toBe(true);
  });

  test("describes sync as a structured tool", async () => {
    const result = await runCli(["--llms"]);

    expect(result.code).toBe(0);
    const manifest = JSON.parse(result.stdout) as {
      tools: Array<{ name: string; inputSchema: { properties: object } }>;
    };
    const sync = manifest.tools.find(tool => tool.name === "sync");
    expect(sync?.inputSchema.properties).toHaveProperty("raw");
    expect(sync?.inputSchema.properties).toHaveProperty("format");
    expect(sync?.inputSchema.properties).toHaveProperty("refresh");
  });

  test("publishes lookup filters", async () => {
    const result = await runCli(["lookup", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[query]");
    expect(result.stdout).toContain("--status <value...>");
    expect(result.stdout).toContain("--task <value...>");
    expect(result.stdout).toContain("--capability <value...>");
    expect(result.stdout).toContain("--min-context <value>");
    expect(result.stdout).toContain("--expression <value>");
    expect(result.stdout).toContain("--refresh");
  });

  test("describes lookup as a structured tool", async () => {
    const result = await runCli(["--llms"]);

    expect(result.code).toBe(0);
    const manifest = JSON.parse(result.stdout) as {
      tools: Array<{ name: string; inputSchema: { properties: object } }>;
    };
    const lookup = manifest.tools.find(tool => tool.name === "lookup");
    expect(lookup?.inputSchema.properties).toHaveProperty("query");
    expect(lookup?.inputSchema.properties).toHaveProperty("status");
    expect(lookup?.inputSchema.properties).toHaveProperty("capability");
    expect(lookup?.inputSchema.properties).toHaveProperty("expression");
    expect(lookup?.inputSchema.properties).toHaveProperty("refresh");
  });

  test("builds a Python query from lookup filters", () => {
    expect(buildLookupQuery({
      query: "gpt",
      status: ["active", "preview"],
      task: ["reasoning", "chat"],
      inputModality: ["text"],
      capability: ["tools", "reasoning"],
      withoutCapability: ["web-search"],
      openWeights: true,
      minContext: 128_000,
      releasedAfter: "2025-01-01",
      orderBy: "release_date",
      direction: "desc",
      limit: 5,
    })).toEqual({
      expression: {
        $and: [
          {
            $or: [
              { id: { $contains: "gpt" } },
              { name: { $contains: "gpt" } },
              { aliases: { $contains: "gpt" } },
              { description: { $contains: "gpt" } },
            ],
          },
          { status: { $in: ["active", "preview"] } },
          { tasks: { $contains: "reasoning" } },
          { tasks: { $contains: "chat" } },
          { modalities: { input: { $contains: "text" } } },
          { capabilities: { tools: { $eq: true } } },
          { capabilities: { reasoning: { $ne: null } } },
          { capabilities: { web_search: { $eq: false } } },
          { open_weights: { $eq: true } },
          { limits: { context: { $gte: 128_000 } } },
          { release_date: { $gte: "2025-01-01" } },
        ],
      },
      options: {
        caseSensitive: false,
        maxDepth: 3,
        orderBy: { field: "release_date", direction: "desc" },
        limit: 5,
      },
    });
  });
});

function runCli(args: readonly string[]): Promise<{
  code: number | null;
  stderr: string;
  stdout: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(import.meta.dir, "..", "src", "cli.ts"), ...args],
      {
        env: { ...process.env, XDG_CACHE_HOME: cliCache },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stderr, stdout }));
  });
}
