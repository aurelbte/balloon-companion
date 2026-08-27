export const CONTROLLED_CLOUD_SYNC_QUERY = "cloudSyncTest=targeted";
export const CONTROLLED_CLOUD_SYNC_SESSION_KEY = "balloon-companion:cloud-sync-targeted";
export const CONTROLLED_CLOUD_SYNC_SESSION_VALUE = "targeted";

export function inspectControlledCloudSyncSources(
  search: string,
  sessionStorage?: Pick<Storage, "getItem"> | null,
): Readonly<{ active: boolean; queryParameter: boolean; sessionFlag: boolean }> {
  const queryParameter = new URLSearchParams(search).get("cloudSyncTest") === "targeted";
  let sessionFlag = false;
  try {
    sessionFlag = sessionStorage?.getItem(CONTROLLED_CLOUD_SYNC_SESSION_KEY) === CONTROLLED_CLOUD_SYNC_SESSION_VALUE;
  } catch { /* Storage unavailable means the session flag cannot activate targeted mode. */ }
  return { active: queryParameter || sessionFlag, queryParameter, sessionFlag };
}

/** Explicit URL/session guard. Targeted mode also disables automatic sync in production. */
export function isAutomaticCloudSyncBlockedForControlledTest(
  _nodeEnv: string | undefined,
  search: string,
  sessionStorage?: Pick<Storage, "getItem"> | null,
): boolean {
  return inspectControlledCloudSyncSources(search, sessionStorage).active;
}

export function createScopeUnavailableControlledApi<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_target, property) => property === "then"
      ? undefined
      : () => Promise.reject(new Error("SCOPE_UNAVAILABLE")),
  });
}
