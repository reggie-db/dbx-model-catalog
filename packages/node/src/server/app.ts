import type { ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Duplex } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Elysia } from "elysia";
import ProxyModule from "http-proxy-3";
import { pyfig, type PyfigOptions, type PythonContext } from "pyfig";
import { PACKAGE_VERSION as PYNECT_VERSION } from "pynect/metadata";
import { serverOptionsSchema, type ServerOptions } from "pynect/schema";
import {
  CATALOG_PYNECT_PATH,
  CATALOG_PYTHON_MODULES,
  CATALOG_PYTHON_REQUIREMENT,
} from "../contract.js";
import { pythonRuntimeEnvironment } from "../runtime.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface CatalogSiteAppOptions {
  siteDirectory: string;
}

export interface CatalogPythonServerOptions extends PyfigOptions, ServerOptions {
  project?: string | false;
  startupTimeoutMs?: number;
  with?: readonly string[];
  withEditable?: readonly string[];
}

export interface CatalogPythonServer extends AsyncDisposable {
  readonly child: ChildProcess;
  readonly context: PythonContext;
  readonly url: URL;
  close(): Promise<void>;
}

export interface CatalogServerOptions extends CatalogSiteAppOptions {
  hostname?: string;
  port?: number;
  python?: CatalogPythonServerOptions;
}

export interface CatalogServer extends AsyncDisposable {
  readonly python: CatalogPythonServer;
  readonly server: Server;
  readonly url: URL;
  close(): Promise<void>;
}

interface ListeningEvent {
  event: "listening";
  pid: number;
  url: string;
}

export function createCatalogSiteApp(options: CatalogSiteAppOptions) {
  return new Elysia()
    .get("/health", () => ({ ok: true as const }))
    .get("/*", async ({ path, status }) => {
      const relative = path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
      const filePath = resolve(options.siteDirectory, relative);
      const rootPrefix = `${resolve(options.siteDirectory)}${sep}`;
      if (filePath !== resolve(options.siteDirectory, "index.html") && !filePath.startsWith(rootPrefix)) {
        return status(404, "Not found");
      }
      const file = Bun.file(filePath);
      if (await file.exists()) return file;
      if (!relative.includes(".")) return Bun.file(resolve(options.siteDirectory, "index.html"));
      return status(404, "Not found");
    });
}

export async function startCatalogServer(options: CatalogServerOptions): Promise<CatalogServer> {
  const site = createCatalogSiteApp(options);
  site.listen({ hostname: "127.0.0.1", port: 0 });
  const sitePort = site.server?.port;
  if (!sitePort) {
    await site.stop();
    throw new Error("Catalog site server did not expose a port.");
  }

  let python: CatalogPythonServer;
  try {
    python = await startCatalogPythonServer(options.python);
  } catch (error) {
    await site.stop();
    throw error;
  }

  const proxy = ProxyModule.createProxyServer({ ws: true, xfwd: true });
  const siteTarget = `http://127.0.0.1:${sitePort}`;
  const pythonTarget = new URL(python.url);
  pythonTarget.protocol = "http:";
  pythonTarget.pathname = "/";
  const upgradedSockets = new Set<Duplex>();
  const server = createServer((request, response) => {
    proxy.web(request, response, { target: siteTarget });
  });
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== python.url.pathname) {
      rejectUpgrade(socket);
      return;
    }
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    proxy.ws(request, socket, head, {
      changeOrigin: true,
      target: pythonTarget.origin,
    });
  });
  proxy.on("error", (_error, _request, response) => {
    if (response && "writeHead" in response && !response.headersSent) {
      response.writeHead(502).end("Bad gateway");
    }
  });

  try {
    await listen(server, options.hostname ?? "127.0.0.1", options.port ?? 8000);
  } catch (error) {
    proxy.close();
    await python.close();
    await site.stop();
    throw error;
  }

  const address = server.address() as AddressInfo;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const socket of upgradedSockets) socket.destroy();
    upgradedSockets.clear();
    await closeServer(server);
    proxy.close();
    await Promise.allSettled([python.close(), site.stop()]);
  };
  return {
    python,
    server,
    url: new URL(`http://${options.hostname ?? "127.0.0.1"}:${address.port}`),
    close,
    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },
  };
}

export async function startCatalogPythonServer(
  options: CatalogPythonServerOptions = {},
): Promise<CatalogPythonServer> {
  const {
    project = false,
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    with: requirements = [CATALOG_PYTHON_REQUIREMENT],
    withEditable = [],
    host,
    maxFrameBytes,
    modules,
    path,
    port,
    validatePydantic,
    ...pyfigOptions
  } = options;
  const serverOptions = serverOptionsSchema.parse({
    ...serverOptionsSchema.parse({}),
    host,
    maxFrameBytes,
    modules: { ...CATALOG_PYTHON_MODULES, ...modules },
    path: path ?? CATALOG_PYNECT_PATH,
    port,
    validatePydantic,
  });
  const context = await pyfig({
    ...pyfigOptions,
    env: pythonRuntimeEnvironment(pyfigOptions.env),
  });
  await context.python.resolve();
  const pythonPath = context.python.path;
  if (!pythonPath) throw new Error("Pyfig resolved Python without exposing its path.");

  const workerRequirement = `pynect-worker[server] @ ${pathToFileURL(findPynectWorkerWheel()).href}`;
  const child = await context.uv.spawn(
    "run",
    "--quiet",
    ...projectArguments(project),
    "--python",
    pythonPath,
    "--with",
    workerRequirement,
    ...requirements.flatMap(requirement => ["--with", requirement]),
    ...withEditable.flatMap(requirement => ["--with-editable", requirement]),
    "--",
    "pynect-server",
    ...serverArguments(serverOptions),
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let url: URL;
  try {
    url = await waitForListening(child, startupTimeoutMs);
  } catch (error) {
    await terminateChild(child);
    throw error;
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await terminateChild(child);
  };
  return {
    child,
    context,
    url,
    close,
    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },
  };
}

function findPynectWorkerWheel(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const packageRoots = [resolve(moduleDirectory, ".."), resolve(moduleDirectory, "../..")];
  const expectedPrefix = `pynect_worker-${PYNECT_VERSION}-`;
  const matches = packageRoots.flatMap(packageRoot => [
    resolve(packageRoot, "node_modules/pynect/dist/py"),
    resolve(packageRoot, "py"),
  ]).flatMap(directory => {
    try {
      return readdirSync(directory)
        .filter(name => name.startsWith(expectedPrefix) && name.endsWith(".whl"))
        .map(name => resolve(directory, name));
    } catch {
      return [];
    }
  });
  const wheel = matches[0];
  if (!wheel) {
    throw new Error(`Could not find the bundled pynect-worker ${PYNECT_VERSION} wheel.`);
  }
  return wheel;
}

function projectArguments(project: string | false): string[] {
  return project === false ? ["--no-project"] : ["--project", project];
}

function serverArguments(options: ServerOptions): string[] {
  const args = [
    "--host",
    options.host!,
    "--port",
    String(options.port!),
    "--path",
    options.path!,
    "--max-frame-bytes",
    String(options.maxFrameBytes!),
    options.validatePydantic === false ? "--no-validate-pydantic" : "--validate-pydantic",
  ];
  for (const [name, target] of Object.entries(options.modules ?? {})) {
    args.push(`--modules.${name}`, target);
  }
  return args;
}

function waitForListening(child: ChildProcess, timeoutMs: number): Promise<URL> {
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) {
    return Promise.reject(new Error("Pynect server did not expose piped output."));
  }
  return new Promise((resolveListening, reject) => {
    const lines = createInterface({ input: stdout });
    let stderrOutput = "";
    const timeout = setTimeout(() => {
      finish(new Error(`Pynect server did not start within ${timeoutMs}ms.`));
    }, timeoutMs);
    timeout.unref();
    const onStderr = (chunk: Buffer): void => {
      stderrOutput = `${stderrOutput}${chunk.toString()}`.slice(-65_536);
      process.stderr.write(chunk);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const detail = stderrOutput.trim() || signal || `exit ${code ?? "unknown"}`;
      finish(new Error(`Pynect server exited before listening: ${detail}`));
    };
    const finish = (error?: Error, url?: URL): void => {
      clearTimeout(timeout);
      lines.close();
      child.off("exit", onExit);
      if (error) reject(error);
      else resolveListening(url!);
    };
    stderr.on("data", onStderr);
    child.once("exit", onExit);
    lines.on("line", line => {
      const event = parseListeningEvent(line);
      if (event) finish(undefined, new URL(event.url));
      else process.stdout.write(`${line}\n`);
    });
  });
}

function parseListeningEvent(line: string): ListeningEvent | undefined {
  try {
    const value = JSON.parse(line) as Partial<ListeningEvent>;
    if (value.event === "listening" && typeof value.pid === "number" && typeof value.url === "string") {
      return value as ListeningEvent;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = childExit(child);
  child.kill("SIGTERM");
  if (await waitWithTimeout(exited, SHUTDOWN_TIMEOUT_MS)) return;
  child.kill("SIGKILL");
  await childExit(child);
}

function childExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolveExit => child.once("exit", () => resolveExit()));
}

async function waitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>(resolveTimeout => {
    timeout = setTimeout(() => resolveTimeout(false), timeoutMs);
    timeout.unref();
  });
  const completed = await Promise.race([promise.then(() => true as const), timedOut]);
  if (timeout) clearTimeout(timeout);
  return completed;
}

function listen(server: Server, hostname: string, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose());
  });
}

function rejectUpgrade(socket: Duplex): void {
  socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}
