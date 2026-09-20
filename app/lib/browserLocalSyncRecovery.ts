import { getRuntimeDataScope } from "./auth/dataScopeRuntime.ts";
import { recoverLocalStorageSyncIntents } from "./durableSyncIntent.ts";
import { balloonDocumentStorage } from "./balloonDocumentStorage.ts";
import { IndexedDbRecordedFlightStorage } from "./recordedFlightStorage.ts";
import type { SyncOutboxStorage } from "./syncOutbox.ts";

/** Before PULL (overwrite protection) and PUSH (no false COMPLETED). */
export async function recoverBrowserLocalSyncIntents(storage: Storage, scope: `USER:${string}`, outbox: SyncOutboxStorage, signal?: AbortSignal): Promise<void> {
  if (getRuntimeDataScope() !== scope) throw new Error("SYNC_INTENT_USER_SWITCH");
  await recoverLocalStorageSyncIntents(storage, scope, outbox, undefined, 30_000, signal);
  signal?.throwIfAborted();
  await balloonDocumentStorage.recoverSyncIntents(scope, outbox, signal);
  signal?.throwIfAborted();
  await new IndexedDbRecordedFlightStorage().recoverSyncIntents(scope, outbox, signal);
  signal?.throwIfAborted();
}
