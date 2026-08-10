import type { KeyValueStorage } from "./deviceIdentity.ts";
import type { AuthProvider, AuthSnapshot, BalloonUser } from "./types.ts";

export const LOCAL_AUTH_SESSION_STORAGE_KEY = "balloon-companion-auth-session-v1";

function parseLocalUser(raw: string | null): BalloonUser | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const user = value as Partial<BalloonUser>;
    if (![user.id, user.email, user.firstName, user.lastName].every((field) => typeof field === "string")) return null;
    return user as BalloonUser;
  } catch {
    return null;
  }
}

export function saveLocalAuthSession(storage: KeyValueStorage, user: BalloonUser): void {
  storage.setItem(LOCAL_AUTH_SESSION_STORAGE_KEY, JSON.stringify(user));
}

export function clearLocalAuthSession(storage: KeyValueStorage): void {
  storage.removeItem?.(LOCAL_AUTH_SESSION_STORAGE_KEY);
}

/** Restaure l'authentification sans coupler l'application à Supabase. */
export async function restoreAuthSnapshot(input: Readonly<{
  provider: AuthProvider;
  storage: KeyValueStorage;
  online: boolean;
}>): Promise<AuthSnapshot> {
  const localUser = parseLocalUser(input.storage.getItem(LOCAL_AUTH_SESSION_STORAGE_KEY));
  if (!input.online) {
    return localUser
      ? { state: "OFFLINE_SESSION", user: localUser }
      : { state: "SIGNED_OUT", user: null };
  }
  try {
    const user = await input.provider.restoreSession();
    if (!user) {
      clearLocalAuthSession(input.storage);
      return { state: "SIGNED_OUT", user: null };
    }
    saveLocalAuthSession(input.storage, user);
    return { state: "SIGNED_IN", user };
  } catch {
    return localUser
      ? { state: "OFFLINE_SESSION", user: localUser }
      : { state: "SIGNED_OUT", user: null };
  }
}

