import { scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";

export type CloudPullCursor = Readonly<{ updatedAt: string; id: string }>;
export interface CloudPullCursorRepository {
  get(scope: `USER:${string}`, domain: string): Promise<CloudPullCursor | null>;
  set(scope: `USER:${string}`, domain: string, cursor: CloudPullCursor): Promise<void>;
}

export const CLOUD_PULL_CURSOR_STORAGE_KEY = "balloon-companion-cloud-pull-cursors-v1";

export class BrowserCloudPullCursorRepository implements CloudPullCursorRepository {
  private readonly storage: Storage;
  constructor(storage: Storage) { this.storage = storage; }

  async get(scope: `USER:${string}`, domain: string): Promise<CloudPullCursor | null> {
    try {
      const value = JSON.parse(this.storage.getItem(scopedBusinessStorageKey(scope, CLOUD_PULL_CURSOR_STORAGE_KEY)) ?? "null") as Record<string, Partial<CloudPullCursor>> | null;
      const cursor = value?.[domain];
      return cursor && typeof cursor.updatedAt === "string" && typeof cursor.id === "string"
        ? { updatedAt: cursor.updatedAt, id: cursor.id }
        : null;
    } catch { return null; }
  }

  async set(scope: `USER:${string}`, domain: string, cursor: CloudPullCursor): Promise<void> {
    const key = scopedBusinessStorageKey(scope, CLOUD_PULL_CURSOR_STORAGE_KEY);
    let current: Record<string, CloudPullCursor> = {};
    try {
      const value = JSON.parse(this.storage.getItem(key) ?? "null");
      if (value && typeof value === "object") current = value as Record<string, CloudPullCursor>;
    } catch {}
    this.storage.setItem(key, JSON.stringify({ ...current, [domain]: cursor }));
  }
}
