import { resolve, sep } from "node:path";
import { Elysia, t } from "elysia";
import {
  DbxModelCatalogPython,
  type ClientModule,
  type CreateVenvOptions,
  type NodeModelCatalogClient,
} from "../index.js";
import type {
  CatalogModel,
  ModelCatalog,
} from "../generated/catalog-types.js";

type CatalogModelRecord = CatalogModel & { readonly id: string };

export interface CatalogRpcAppOptions {
  catalogPath: string;
  python?: CreateVenvOptions;
  siteDirectory: string;
}

export function createCatalogRpcApp(options: CatalogRpcAppOptions) {
  const python = new DbxModelCatalogPython(options.python);
  const catalogPromise = Bun.file(options.catalogPath).json() as Promise<ModelCatalog>;
  let clientModulePromise: Promise<ClientModule> | undefined;
  let clientPromise: Promise<NodeModelCatalogClient> | undefined;

  const catalogClient = () => {
    clientPromise ??= (async () => {
      const payload = await catalogPromise;
      clientModulePromise ??= python.client;
      const module = await clientModulePromise;
      return module.NodeModelCatalogClient(payload as unknown as Record<string, unknown>);
    })();
    return clientPromise;
  };

  return new Elysia()
    .get("/rpc/health", () => ({ ok: true as const }))
    .get("/rpc/catalog", (): Promise<ModelCatalog> => catalogPromise)
    .get("/rpc/models/:id", async ({ params, status }): Promise<CatalogModelRecord> => {
      const model = (await catalogPromise).models[params.id];
      if (!model) return status(404, { message: `Unknown model: ${params.id}` }) as never;
      return { ...model, id: params.id };
    })
    .post(
      "/rpc/query",
      async ({ body }): Promise<readonly CatalogModelRecord[]> => {
        const client = await catalogClient();
        return await client.query(body.expression, body.options) as unknown as CatalogModelRecord[];
      },
      {
        body: t.Object({
          expression: t.Optional(t.Record(t.String(), t.Unknown())),
          options: t.Optional(t.Record(t.String(), t.Unknown())),
        }),
      },
    )
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
    })
    .onStop(async () => {
      if (clientPromise) await (await clientPromise).$release().catch(() => undefined);
      await python.close();
    });
}

export type CatalogRpcApp = ReturnType<typeof createCatalogRpcApp>;
