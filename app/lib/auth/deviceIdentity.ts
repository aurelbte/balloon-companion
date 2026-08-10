import type { DeviceIdentity } from "./types.ts";

export const DEVICE_IDENTITY_STORAGE_KEY = "balloon-companion-device-identity-v1";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

type DeviceIdentityDependencies = Readonly<{
  createId?: () => string;
  now?: () => string;
}>;

function createDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  throw new Error("Secure device identity generation is unavailable");
}

function parseDeviceIdentity(raw: string | null): DeviceIdentity | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const identity = value as Partial<DeviceIdentity>;
    if (![identity.deviceId, identity.createdAt, identity.lastSeenAt].every((field) => typeof field === "string" && field.length > 0)) return null;
    return identity as DeviceIdentity;
  } catch {
    return null;
  }
}

/** Utilise une clé Auth dédiée et ne lit ni ne modifie aucun stockage métier. */
export function getOrCreateDeviceIdentity(
  storage: KeyValueStorage,
  dependencies: DeviceIdentityDependencies = {},
): DeviceIdentity {
  const now = (dependencies.now ?? (() => new Date().toISOString()))();
  const existing = parseDeviceIdentity(storage.getItem(DEVICE_IDENTITY_STORAGE_KEY));
  const identity: DeviceIdentity = existing
    ? { ...existing, lastSeenAt: now }
    : { deviceId: (dependencies.createId ?? createDeviceId)(), createdAt: now, lastSeenAt: now };
  storage.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

