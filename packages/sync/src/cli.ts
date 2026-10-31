import { CatalogSync } from "./catalog-sync.ts";
import { stringifyJson } from "./json.ts";

const args = Bun.argv.slice(2);
const sync = new CatalogSync();
const result = args.includes("--raw")
  ? await sync.syncSources()
  : await sync.syncAll();

console.log(stringifyJson(result, args.includes("--format") ? 2 : undefined));
