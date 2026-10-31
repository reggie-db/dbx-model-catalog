import type { ModelCatalog } from "@dbx-model-catalog/common";
import { buildModelCatalog, type CatalogSyncSources } from "./catalog.ts";
import {
  type DatabricksCatalogData,
  DatabricksSyncClient,
} from "./databricks.ts";
import {
  LMArenaSyncClient,
  type LMArenaCatalogData,
} from "./lm-arena.ts";
import {
  LiveBenchSyncClient,
  type LiveBenchCatalogData,
} from "./livebench.ts";
import {
  type ModelParamsData,
  ModelParamsSyncClient,
} from "./modelparams.ts";
import {
  type ModelsDevData,
  ModelsDevSyncClient,
} from "./models-dev.ts";
import { ClientSyncService, type SyncService } from "./sync-service.ts";

export class CatalogSync {
  public constructor(
    private readonly modelsDev: SyncService<"models.dev", ModelsDevData> =
      new ClientSyncService("models.dev", new ModelsDevSyncClient()),
    private readonly modelParams: SyncService<"modelparams.dev", ModelParamsData> =
      new ClientSyncService("modelparams.dev", new ModelParamsSyncClient()),
    private readonly lmArena: SyncService<"lm-arena", LMArenaCatalogData> =
      new ClientSyncService("lm-arena", new LMArenaSyncClient()),
    private readonly liveBench: SyncService<"livebench", LiveBenchCatalogData> =
      new ClientSyncService("livebench", new LiveBenchSyncClient()),
    private readonly databricks: SyncService<"databricks", DatabricksCatalogData> =
      new ClientSyncService("databricks", new DatabricksSyncClient()),
  ) {}

  public async syncSources(): Promise<CatalogSyncSources> {
    const [modelsDev, modelParams, lmArena, liveBench, databricks] = await Promise.all([
      this.modelsDev.sync(),
      this.modelParams.sync(),
      this.lmArena.sync(),
      this.liveBench.sync(),
      this.databricks.sync(),
    ]);

    return { modelsDev, modelParams, lmArena, liveBench, databricks };
  }

  public async syncAll(): Promise<ModelCatalog> {
    return buildModelCatalog(await this.syncSources());
  }
}
