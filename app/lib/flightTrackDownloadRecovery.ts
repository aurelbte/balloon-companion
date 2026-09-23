import { getRuntimeDataScope, getRuntimeDataScopeGeneration } from "./auth/dataScopeRuntime.ts";
import { hasLocalStorageSyncIntent } from "./durableSyncIntent.ts";
import type { RecordedFlightRecoveryInspection } from "./recordedFlightStorage.ts";
import type { SyncOutboxStorage } from "./syncOutbox.ts";
import type { FlightTrackJob, FlightTrackQueueStorage } from "./flightTrackQueue.ts";

export async function recoverMissingFlightTrackDownloads(input: Readonly<{
  scope: `USER:${string}`; storage: Storage;
  queue: Pick<FlightTrackQueueStorage, "list" | "replaceIfUnchanged">;
  outbox: Pick<SyncOutboxStorage, "list">;
  inspectLocal(id: string): Promise<RecordedFlightRecoveryInspection>;
  restoreFromCloud(id: string): Promise<"RESTORED" | "ABSENT">;
  getScope?: typeof getRuntimeDataScope; getGeneration?: typeof getRuntimeDataScopeGeneration;
}>): Promise<Readonly<{ restored: number; removed: number }>> {
  const getScope = input.getScope ?? getRuntimeDataScope, getGeneration = input.getGeneration ?? getRuntimeDataScopeGeneration;
  const generation = getGeneration(), current = () => getScope() === input.scope && getGeneration() === generation;
  let restored = 0, removed = 0;
  if (!current()) return { restored, removed };
  const jobs = (await input.queue.list()).filter(job => job.operation === "DOWNLOAD" && job.status === "FAILED" && job.lastErrorCode === "LOCAL_FLIGHT_METADATA_NOT_FOUND" && job.scope === input.scope);
  for (const job of jobs) {
    if (!current()) break;
    const local = await input.inspectLocal(job.flightId);
    const mutations = (await input.outbox.list()).filter(mutation => mutation.entityType === "flight" && mutation.entityId === job.flightId);
    let storedIntent = true;
    try { storedIntent = hasLocalStorageSyncIntent(input.storage, input.scope, "flight", job.flightId); } catch { continue; }
    if (!current() || local.rawRecordPresent || local.activeFlightWithSameId || local.matchingIntentIds.length || mutations.length || storedIntent) continue;
    let cloud: "RESTORED" | "ABSENT";
    try { cloud = await input.restoreFromCloud(job.flightId); } catch { continue; }
    if (!current()) break;
    if (cloud === "RESTORED") {
      const replacement: FlightTrackJob = { ...job, status: "PENDING", attempts: job.attempts, updatedAt: new Date().toISOString() };
      delete (replacement as { nextEligibleRetryAt?: string }).nextEligibleRetryAt;
      delete (replacement as { lastErrorCode?: string }).lastErrorCode;
      delete (replacement as { lastErrorCategory?: string }).lastErrorCategory;
      if (await input.queue.replaceIfUnchanged(job, replacement)) restored += 1;
      continue;
    }
    const finalLocal = await input.inspectLocal(job.flightId);
    const finalMutations = (await input.outbox.list()).filter(mutation => mutation.entityType === "flight" && mutation.entityId === job.flightId);
    let finalIntent = true;
    try { finalIntent = hasLocalStorageSyncIntent(input.storage, input.scope, "flight", job.flightId); } catch { continue; }
    if (!current() || finalLocal.rawRecordPresent || finalLocal.activeFlightWithSameId || finalLocal.matchingIntentIds.length || finalMutations.length || finalIntent) continue;
    if (await input.queue.replaceIfUnchanged(job, null)) removed += 1;
  }
  return { restored, removed };
}
