import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Increment = "major" | "minor" | "patch";

const ROOT = path.resolve(import.meta.dir, "..");
const REMOTE = "origin";
const RELEASE_BRANCH = "main";
const args = new Set(process.argv.slice(2));
const increments = (["patch", "minor", "major"] as const).filter((value) => args.has(value));
const knownArgs = new Set(["patch", "minor", "major", "--dry-run"]);
const unknownArgs = [...args].filter((value) => !knownArgs.has(value));

if (increments.length > 1) throw new Error("Choose only one increment: patch, minor, or major.");
if (unknownArgs.length > 0) throw new Error(`Unknown release argument: ${unknownArgs.join(", ")}.`);

const increment: Increment = increments[0] ?? "patch";
const dryRun = args.has("--dry-run");
const versionFiles = await discoverVersionFiles();
const snapshots = new Map<string, string>();
for (const filename of versionFiles) {
  snapshots.set(filename, await readFile(path.join(ROOT, filename), "utf8"));
}

let releaseHistoryCreated = false;

try {
  await assertReleaseState();

  const currentVersions = await readVersions(versionFiles);
  const latestTag = await latestRemoteTag();
  if (!latestTag) throw new Error("The remote has no stable release tag.");
  const currentVersion = latestTag.slice(1);
  const npmVersions = [...currentVersions]
    .filter(([filename]) => filename.endsWith("package.json"));
  const mismatchedNpmVersions = npmVersions
    .filter(([, version]) => version !== currentVersion);
  if (mismatchedNpmVersions.length > 0) {
    throw new Error(
      `npm package versions must match ${latestTag}: ${mismatchedNpmVersions.map(([file, version]) => `${file}=${version}`).join(", ")}.`,
    );
  }

  const nextVersion = incrementVersion(currentVersion, increment);
  const tag = `v${nextVersion}`;
  if (await git(["tag", "--list", tag])) throw new Error(`Local tag ${tag} already exists.`);
  if (await remoteTagExists(tag)) throw new Error(`Remote tag ${tag} already exists.`);

  console.log(`${dryRun ? "Dry run" : "Release"}: ${currentVersion} -> ${nextVersion} (${tag}).`);
  await updateVersions(versionFiles, nextVersion);
  await run(["bun", "run", "check"]);

  const changed = await changedPaths();
  const unexpected = changed.filter((filename) => !versionFiles.includes(filename));
  if (unexpected.length > 0) {
    throw new Error(`Release changed unexpected files: ${unexpected.join(", ")}.`);
  }

  if (dryRun) {
    console.log(`Dry run passed for ${tag}.`);
  } else {
    await run(["git", "add", "--", ...versionFiles]);
    await run(["git", "commit", "-m", `release: ${tag}`]);
    await run(["git", "tag", tag]);
    releaseHistoryCreated = true;
    await run([
      "git",
      "push",
      "--atomic",
      REMOTE,
      `HEAD:refs/heads/${RELEASE_BRANCH}`,
      `refs/tags/${tag}`,
    ]);
    console.log(`Pushed ${tag}; GitHub Actions will publish the packages and release assets.`);
  }
} finally {
  if (dryRun || !releaseHistoryCreated) {
    await restoreVersions();
  }
}

async function assertReleaseState(): Promise<void> {
  if (await git(["status", "--porcelain=v1", "--untracked-files=all"])) {
    throw new Error("Release requires a clean worktree.");
  }
  const branch = await git(["branch", "--show-current"]);
  if (branch !== RELEASE_BRANCH) {
    throw new Error(`Release must run from ${RELEASE_BRANCH}, not ${branch || "<detached>"}.`);
  }

  await run(["git", "fetch", "--prune", REMOTE, RELEASE_BRANCH]);
  const localHead = await git(["rev-parse", "HEAD"]);
  const remoteHead = await git(["rev-parse", `${REMOTE}/${RELEASE_BRANCH}`]);
  if (localHead !== remoteHead) {
    throw new Error(`${RELEASE_BRANCH} must exactly match ${REMOTE}/${RELEASE_BRANCH}.`);
  }
}

async function discoverVersionFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(ROOT, "packages/js"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const filename = `packages/js/${entry.name}/package.json`;
    const manifest = JSON.parse(await readFile(path.join(ROOT, filename), "utf8")) as {
      private?: boolean;
      version?: string;
    };
    if (manifest.private !== true && manifest.version) files.push(filename);
  }
  for (const entry of await readdir(path.join(ROOT, "packages/py"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    files.push(`packages/py/${entry.name}/pyproject.toml`);
  }
  return files.sort();
}

async function readVersions(files: readonly string[]): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  for (const filename of files) {
    const source = await readFile(path.join(ROOT, filename), "utf8");
    const version = filename.endsWith("package.json")
      ? (JSON.parse(source) as { version?: string }).version
      : projectVersion(source, filename);
    if (!version || !parseVersion(version)) throw new Error(`${filename} has an invalid release version.`);
    versions.set(filename, version);
  }
  return versions;
}

async function updateVersions(files: readonly string[], version: string): Promise<void> {
  for (const filename of files) {
    const absolutePath = path.join(ROOT, filename);
    const source = await readFile(absolutePath, "utf8");
    if (filename.endsWith("package.json")) {
      const manifest = JSON.parse(source) as Record<string, unknown>;
      manifest.version = version;
      await writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      continue;
    }

    const bounds = projectSectionBounds(source, filename);
    const section = source.slice(bounds.start, bounds.end);
    const updated = section.replace(/^version\s*=\s*"[^"]+"\s*$/mu, `version = "${version}"`);
    if (updated === section) throw new Error(`${filename} does not declare project.version.`);
    await writeFile(absolutePath, `${source.slice(0, bounds.start)}${updated}${source.slice(bounds.end)}`, "utf8");
  }
}

function projectVersion(source: string, filename: string): string {
  const bounds = projectSectionBounds(source, filename);
  const match = /^version\s*=\s*"([^"]+)"\s*$/mu.exec(source.slice(bounds.start, bounds.end));
  if (!match?.[1]) throw new Error(`${filename} does not declare project.version.`);
  return match[1];
}

function projectSectionBounds(source: string, filename: string): { start: number; end: number } {
  const header = /^\[project\]\s*$/mu.exec(source);
  if (!header) throw new Error(`${filename} does not contain a [project] section.`);
  const start = header.index + header[0].length;
  const nextHeader = /^\[[^\]]+\]\s*$/gmu;
  nextHeader.lastIndex = start;
  const next = nextHeader.exec(source);
  return { start, end: next?.index ?? source.length };
}

function incrementVersion(version: string, increment: Increment): string {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`Invalid stable SemVer: ${version}.`);
  if (increment === "major") return `${parsed.major + 1}.0.0`;
  if (increment === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function parseVersion(version: string): { major: number; minor: number; patch: number } | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

async function latestRemoteTag(): Promise<string | undefined> {
  const output = await git(["ls-remote", "--tags", "--refs", REMOTE, "refs/tags/v*"]);
  return output
    .split(/\r?\n/u)
    .map((line) => /refs\/tags\/(v\d+\.\d+\.\d+)$/u.exec(line)?.[1])
    .filter((value): value is string => Boolean(value))
    .sort(compareTags)
    .at(-1);
}

function compareTags(left: string, right: string): number {
  const leftVersion = parseVersion(left.slice(1));
  const rightVersion = parseVersion(right.slice(1));
  if (!leftVersion || !rightVersion) return left.localeCompare(right);
  return leftVersion.major - rightVersion.major
    || leftVersion.minor - rightVersion.minor
    || leftVersion.patch - rightVersion.patch;
}

async function remoteTagExists(tag: string): Promise<boolean> {
  return Boolean(await git(["ls-remote", "--tags", "--refs", REMOTE, `refs/tags/${tag}`]));
}

async function changedPaths(): Promise<string[]> {
  const output = await git(["status", "--porcelain=v1", "--untracked-files=all"]);
  return output
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3))
    .sort();
}

async function restoreVersions(): Promise<void> {
  for (const [filename, source] of snapshots) {
    await writeFile(path.join(ROOT, filename), source, "utf8");
  }
}

async function git(args: readonly string[]): Promise<string> {
  return run(["git", ...args], true);
}

async function run(command: readonly string[], capture = false): Promise<string> {
  const process = Bun.spawn([...command], {
    cwd: ROOT,
    stdout: capture ? "pipe" : "inherit",
    stderr: capture ? "pipe" : "inherit",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    capture ? new Response(process.stdout).text() : Promise.resolve(""),
    capture ? new Response(process.stderr).text() : Promise.resolve(""),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}.`);
  }
  return stdout.trim();
}
