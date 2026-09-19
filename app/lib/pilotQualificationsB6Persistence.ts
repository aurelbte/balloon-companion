import { recoverLocalStorageSyncIntents } from "./durableSyncIntent.ts";
import { applyPilotQualificationsFromCloudWithoutEnqueue, loadPilotQualifications, savePilotQualifications } from "./pilotQualificationsStorage.ts";
import type { QualificationProfile } from "./pilotQualifications.ts";
import type { PilotQualificationsCloudSnapshot } from "./pilotQualificationsCloudReader.ts";
import type { CloudSyncIssueRepository } from "./cloudSyncService.ts";
import { IndexedDbSyncOutboxStorage, type SyncOutboxStorage } from "./syncOutbox.ts";

export async function persistPilotQualificationsB6Choice(input: Readonly<{
  scope: `USER:${string}`;
  storage: Storage;
  strategy: "DEVICE" | "CLOUD";
  deviceProfile: QualificationProfile;
  cloud: PilotQualificationsCloudSnapshot;
  outbox?: SyncOutboxStorage;
  issues: Pick<CloudSyncIssueRepository, "list">;
}>): Promise<void> {
  const outbox = input.outbox ?? new IndexedDbSyncOutboxStorage(input.scope);
  const historical = (await outbox.list()).filter(mutation => mutation.entityType === "pilot-qualifications" && mutation.entityId === "singleton");
  const existingCloudConflict = (await input.issues.list()).some(issue => issue.kind === "CONFLICT" && issue.entityType === "pilot-qualifications" && issue.entityId === "singleton");
  if (existingCloudConflict) {
    const value = input.strategy === "DEVICE"
      ? { profile: input.deviceProfile, events: loadPilotQualifications(input.storage).events }
      : input.cloud.value;
    if (!applyPilotQualificationsFromCloudWithoutEnqueue(input.scope, value, input.strategy === "CLOUD" && Boolean(input.cloud.deletedAt), input.storage)) throw new Error("QUALIFICATION_SAVE_FAILED");
    return;
  }
  if (input.strategy === "CLOUD") {
    if (!applyPilotQualificationsFromCloudWithoutEnqueue(input.scope, input.cloud.value, Boolean(input.cloud.deletedAt), input.storage)) throw new Error("QUALIFICATION_SAVE_FAILED");
    await outbox.setMetadata({ entityType: "pilot-qualifications", entityId: "singleton", revision: input.cloud.revision, updatedAt: input.cloud.updatedAt, ...(input.cloud.deletedAt ? { deletedAt: input.cloud.deletedAt } : {}) });
    await outbox.removeMany(historical.map(mutation => mutation.mutationId));
    return;
  }

  const current = loadPilotQualifications(input.storage);
  if (!savePilotQualifications({ profile: input.deviceProfile, events: current.events }, input.storage, { enqueue: false })) throw new Error("QUALIFICATION_SAVE_FAILED");
  await outbox.setMetadata({ entityType: "pilot-qualifications", entityId: "singleton", revision: input.cloud.revision, updatedAt: input.cloud.updatedAt, ...(input.cloud.deletedAt ? { deletedAt: input.cloud.deletedAt } : {}) });
  await outbox.removeMany(historical.map(mutation => mutation.mutationId));
  if (!await recoverLocalStorageSyncIntents(input.storage, input.scope, outbox, { entityType: "pilot-qualifications", entityId: "singleton" })) throw new Error("QUALIFICATION_ENQUEUE_FAILED");
}
