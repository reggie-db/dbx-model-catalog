import { fileURLToPath } from "node:url";
import type { CatalogClient } from "./types.js";

const packageRootUrl = new URL("..", import.meta.url);
const packageRoot = fileURLToPath(packageRootUrl);
const serverRoot = fileURLToPath(new URL("dist/python", packageRootUrl));

export interface ConnectModelCatalogOptions {
  python?: string;
  url?: string;
}

export interface ModelCatalogSession extends AsyncDisposable {
  readonly client: CatalogClient;
  readonly mode: "ipc" | "remote";
  readonly root: string;
  readonly pid: number | undefined;
  close(): Promise<void>;
}

export async function connectModelCatalog(
  input?: string | ConnectModelCatalogOptions,
): Promise<ModelCatalogSession> {
  const [{ createCatalogClientFromOptions }, { startWorker }] = await Promise.all([
    import("./client.js"),
    import("pynect"),
  ]);
  const options = typeof input === "string" ? { url: input } : (input ?? {});
  const remoteUrl = options.url?.trim() || undefined;
  const worker = remoteUrl
    ? undefined
    : await startWorker({
        python: options.python,
        root: serverRoot,
      });
  const client = createCatalogClientFromOptions(
    remoteUrl ? { baseUrl: remoteUrl } : worker!.clientOptions,
  );
  const close = async (): Promise<void> => {
    client.close();
    await worker?.close();
  };

  return {
    client,
    mode: remoteUrl ? ("remote" as const) : ("ipc" as const),
    root: packageRoot,
    get pid(): number | undefined {
      return worker?.pid;
    },
    close,
    async [Symbol.asyncDispose](): Promise<void> {
      await close();
    },
  };
}

export type * from "./browser.js";
export { createCatalogClient } from "./browser.js";
