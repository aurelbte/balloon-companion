export const CLOUD_SYNC_REPAIR_REQUESTED_EVENT = "balloon-companion:cloud-sync-repair-requested";

export function requestCloudSyncRepair(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLOUD_SYNC_REPAIR_REQUESTED_EVENT));
}
