import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cacheable, Keyv } from "cacheable";
import { KeyvFile } from "keyv-file";
import type { z } from "zod";

export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export const SYNC_CLIENT_CACHE_TTL = "1h";
export const SYNC_CLIENT_CACHE_DIRECTORY = join(tmpdir(), "dbx-model-catalog");

export interface SyncClientOptions {
  readonly cacheDirectory?: string;
  readonly cacheEnabled?: boolean;
  readonly cacheName?: string;
  readonly cacheTtl?: number | string;
}

const caches = new Map<string, Cacheable>();

export function syncClientCachePath(
  clientName: string,
  directory = SYNC_CLIENT_CACHE_DIRECTORY,
): string {
  return join(directory, `${cacheFileName(clientName)}.json`);
}

export abstract class SyncClient<TData> {
  protected abstract readonly schema: z.ZodType<TData>;

  private readonly cacheEnabled: boolean;
  private readonly cacheDirectory: string;
  private readonly cacheName: string | undefined;
  private readonly cacheTtl: number | string;

  public constructor(options: SyncClientOptions = {}) {
    this.cacheEnabled = options.cacheEnabled ?? true;
    this.cacheDirectory = options.cacheDirectory ?? SYNC_CLIENT_CACHE_DIRECTORY;
    this.cacheName = options.cacheName;
    this.cacheTtl = options.cacheTtl ?? SYNC_CLIENT_CACHE_TTL;
  }

  public abstract read(): Promise<TData>;

  protected get cache(): Cacheable {
    const filename = syncClientCachePath(
      this.cacheName ?? this.constructor.name,
      this.cacheDirectory,
    );
    const existing = caches.get(filename);
    if (existing) return existing;

    mkdirSync(this.cacheDirectory, { recursive: true });
    const store = new KeyvFile({
      filename,
      checkFileLock: true,
      writeDelay: 0,
    });
    const cache = new Cacheable({
      primary: new Keyv({ store }),
      ttl: this.cacheTtl,
    });
    caches.set(filename, cache);
    return cache;
  }

  protected async cacheGetOrSet<T>(
    key: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    if (!this.cacheEnabled) return loader();
    const value = await this.cache.getOrSet(key, loader, {
      throwErrors: true,
    });
    if (value === undefined) {
      throw new Error(`Cache loader returned undefined for ${key}`);
    }
    return value;
  }

  protected parse(value: unknown): TData {
    return this.schema.parse(value);
  }
}

export abstract class JsonSyncClient<TData> extends SyncClient<TData> {
  protected abstract readonly url: string;

  public constructor(
    private readonly fetcher: Fetcher = fetch,
    options: SyncClientOptions = {},
  ) {
    super(options);
  }

  public async read(): Promise<TData> {
    const value = await this.cacheGetOrSet(this.url, async () => {
      const response = await this.fetcher(this.url, {
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `GET ${this.url} failed with ${response.status} ${response.statusText}`,
        );
      }

      return response.json() as Promise<unknown>;
    });
    return this.parse(value);
  }
}

function cacheFileName(clientName: string): string {
  const name = clientName
    .replace(/SyncClient$/u, "")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1-$2")
    .replace(/([a-z\d])([A-Z])/gu, "$1-$2")
    .replace(/[^a-zA-Z\d]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
  return name || "sync";
}
