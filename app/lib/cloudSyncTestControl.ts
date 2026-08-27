export const CONTROLLED_CLOUD_SYNC_QUERY = "cloudSyncTest=targeted";
export const CONTROLLED_CLOUD_SYNC_SESSION_KEY = "balloon-companion:cloud-sync-targeted";
export const CONTROLLED_CLOUD_SYNC_SESSION_VALUE = "targeted";

/** Explicit URL/session guard. Targeted mode also disables automatic sync in production. */
export function isAutomaticCloudSyncBlockedForControlledTest(
  _nodeEnv: string | undefined,
  search: string,
  sessionStorage?: Pick<Storage, "getItem"> | null,
): boolean {
  if (new URLSearchParams(search).get("cloudSyncTest") === "targeted") return true;
  try {
    return sessionStorage?.getItem(CONTROLLED_CLOUD_SYNC_SESSION_KEY) === CONTROLLED_CLOUD_SYNC_SESSION_VALUE;
  } catch {
    return false;
  }
}

export function createScopeUnavailableControlledApi<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_target, property) => property === "then"
      ? undefined
      : () => Promise.reject(new Error("SCOPE_UNAVAILABLE")),
  });
}
