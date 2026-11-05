# @regbo/dbx-model-catalog

The Node client uses local Pynect IPC unless a WebSocket URL is supplied.

```ts
import { connectModelCatalog } from '@regbo/dbx-model-catalog';

await using catalog = await connectModelCatalog();
console.log(await catalog.client.list({ query: 'gpt' }));

await using remote = await connectModelCatalog('wss://catalog.example.com');
console.log(await remote.client.catalog());
```

The package contains no catalog models or transport adapters; both come from the
Python-owned generated contract in `packages/js/common`.
