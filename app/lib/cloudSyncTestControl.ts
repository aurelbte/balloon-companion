export const CONTROLLED_CLOUD_SYNC_QUERY = "cloudSyncTest=targeted";

/** Non-persistent guard. Production builds can never activate this test mode. */
export function isAutomaticCloudSyncBlockedForControlledTest(
  nodeEnv: string | undefined,
  search: string,
): boolean {
  return nodeEnv === "development" && new URLSearchParams(search).get("cloudSyncTest") === "targeted";
}
