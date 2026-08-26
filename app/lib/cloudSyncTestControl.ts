export const CONTROLLED_CLOUD_SYNC_QUERY = "cloudSyncTest=targeted";

/** Explicit, non-persistent URL guard. Targeted mode also disables automatic sync in production. */
export function isAutomaticCloudSyncBlockedForControlledTest(
  _nodeEnv: string | undefined,
  search: string,
): boolean {
  return new URLSearchParams(search).get("cloudSyncTest") === "targeted";
}

export function createScopeUnavailableControlledApi<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_target, property) => property === "then"
      ? undefined
      : () => Promise.reject(new Error("SCOPE_UNAVAILABLE")),
  });
}
