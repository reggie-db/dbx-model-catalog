import {
  ModelCatalogSchema,
  type ModelCatalog,
} from "@dbx-model-catalog/common";
import {
  type CatalogModelRecord,
  type CatalogQuery,
  type CatalogQueryOptions,
  queryCatalogModels,
} from "./query.ts";

export type CatalogPayloadEncoding = "brotli" | "json";

export interface CatalogFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type CatalogFetch = (url: string) => Promise<CatalogFetchResponse>;
export type CatalogPayloadDecoder = (
  bytes: Uint8Array,
  encoding: CatalogPayloadEncoding,
) => string | Promise<string>;

export interface CatalogLoadOptions {
  readonly fetch?: CatalogFetch;
  readonly decode?: CatalogPayloadDecoder;
}

export interface CatalogDecodeOptions {
  readonly decode?: CatalogPayloadDecoder;
}

export class ModelCatalogClient {
  readonly catalog: ModelCatalog;

  private constructor(catalog: ModelCatalog) {
    this.catalog = catalog;
  }

  static fromCatalog(value: unknown): ModelCatalogClient {
    return new ModelCatalogClient(ModelCatalogSchema.parse(value));
  }

  static fromJson(json: string): ModelCatalogClient {
    return ModelCatalogClient.fromCatalog(JSON.parse(json));
  }

  static async fromBrotli(
    bytes: Uint8Array,
    options: CatalogDecodeOptions = {},
  ): Promise<ModelCatalogClient> {
    const json = await (options.decode ?? decodeCatalogPayload)(bytes, "brotli");
    return ModelCatalogClient.fromJson(json);
  }

  static async fromUrl(
    url: string,
    options: CatalogLoadOptions = {},
  ): Promise<ModelCatalogClient> {
    const response = await (options.fetch ?? fetchCatalog)(url);
    if (!response.ok) {
      const suffix = response.statusText ? ` ${response.statusText}` : "";
      throw new Error(`Catalog request failed with ${response.status}${suffix}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const encoding = looksLikeJson(bytes) ? "json" : "brotli";
    const json = await (options.decode ?? decodeCatalogPayload)(bytes, encoding);
    return ModelCatalogClient.fromJson(json);
  }

  get schemaVersion(): ModelCatalog["schema_version"] {
    return this.catalog.schema_version;
  }

  get updatedAt(): string {
    return this.catalog.updated_at;
  }

  get size(): number {
    return Object.keys(this.catalog.models).length;
  }

  get(id: string): CatalogModelRecord | undefined {
    const model = this.catalog.models[id];
    return model ? { id, ...model } : undefined;
  }

  all(): CatalogModelRecord[] {
    return queryCatalogModels(this.catalog.models);
  }

  query(
    expression: CatalogQuery = () => true,
    options: CatalogQueryOptions = {},
  ): CatalogModelRecord[] {
    return queryCatalogModels(this.catalog.models, expression, options);
  }
}

async function fetchCatalog(url: string): Promise<CatalogFetchResponse> {
  if (typeof globalThis.fetch !== "function") {
    throw new Error(
      "This runtime does not provide fetch; pass CatalogLoadOptions.fetch.",
    );
  }
  return globalThis.fetch(url);
}

async function decodeCatalogPayload(
  bytes: Uint8Array,
  encoding: CatalogPayloadEncoding,
): Promise<string> {
  if (encoding === "json") return decodeUtf8(bytes);
  if (
    typeof globalThis.DecompressionStream !== "function" ||
    typeof globalThis.Blob !== "function" ||
    typeof globalThis.Response !== "function"
  ) {
    throw new Error(
      "This runtime does not provide native Brotli decompression; pass CatalogLoadOptions.decode.",
    );
  }

  const source = new Blob([bytes.slice().buffer]).stream();
  const BrotliDecompressionStream = globalThis.DecompressionStream as unknown as {
    new (format: string): DecompressionStream;
  };
  const decompressor = new BrotliDecompressionStream("brotli");
  const decompressed = source.pipeThrough(decompressor);
  return decodeUtf8(new Uint8Array(await new Response(decompressed).arrayBuffer()));
}

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof globalThis.TextDecoder !== "function") {
    throw new Error(
      "This runtime does not provide TextDecoder; pass CatalogLoadOptions.decode.",
    );
  }
  return new TextDecoder().decode(bytes);
}

function looksLikeJson(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    return byte === 0x7b;
  }
  return false;
}
