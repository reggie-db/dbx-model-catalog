import type { ModelSource, SyncResult } from "@dbx-model-catalog/common";
import type { SyncClient } from "./client.ts";

export abstract class SyncService<TSource extends ModelSource, TData> {
  protected constructor(public readonly source: TSource) {}

  protected abstract read(): Promise<TData>;

  public async sync(): Promise<SyncResult<TSource, TData>> {
    const data = await this.read();

    return {
      source: this.source,
      fetchedAt: new Date().toISOString(),
      data,
    };
  }
}

export class ClientSyncService<TSource extends ModelSource, TData> extends SyncService<
  TSource,
  TData
> {
  public constructor(
    source: TSource,
    private readonly client: SyncClient<TData>,
  ) {
    super(source);
  }

  protected read(): Promise<TData> {
    return this.client.read();
  }
}
