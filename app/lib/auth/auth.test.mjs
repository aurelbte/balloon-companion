import assert from "node:assert/strict";
import test from "node:test";
import { DEVICE_IDENTITY_STORAGE_KEY, getOrCreateDeviceIdentity } from "./deviceIdentity.ts";
import { restoreAuthSnapshot, saveLocalAuthSession } from "./session.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function provider(restoredUser) {
  return {
    getCurrentUser: async () => restoredUser,
    signUp: async () => { throw new Error("not used"); },
    signIn: async () => { throw new Error("not used"); },
    signOut: async () => undefined,
    restoreSession: async () => restoredUser,
  };
}

const user = { id: "user-1", email: "pilot@example.com", firstName: "Ada", lastName: "Lovelace" };

test("le deviceId est généré une seule fois et persiste", () => {
  const storage = memoryStorage();
  let generations = 0;
  const first = getOrCreateDeviceIdentity(storage, {
    createId: () => `device-${++generations}`,
    now: () => "2026-08-10T08:00:00.000Z",
  });
  const second = getOrCreateDeviceIdentity(storage, {
    createId: () => `device-${++generations}`,
    now: () => "2026-08-10T09:00:00.000Z",
  });
  assert.equal(generations, 1);
  assert.equal(second.deviceId, first.deviceId);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.lastSeenAt, "2026-08-10T09:00:00.000Z");
  assert.equal(JSON.parse(storage.getItem(DEVICE_IDENTITY_STORAGE_KEY)).deviceId, first.deviceId);
});

test("une session provider simulée est restaurée en SIGNED_IN", async () => {
  const snapshot = await restoreAuthSnapshot({ provider: provider(user), storage: memoryStorage(), online: true });
  assert.deepEqual(snapshot, { state: "SIGNED_IN", user });
});

test("l'absence de compte produit SIGNED_OUT", async () => {
  const snapshot = await restoreAuthSnapshot({ provider: provider(null), storage: memoryStorage(), online: true });
  assert.deepEqual(snapshot, { state: "SIGNED_OUT", user: null });
});

test("une session locale existante permet OFFLINE_SESSION", async () => {
  const storage = memoryStorage();
  saveLocalAuthSession(storage, user);
  const snapshot = await restoreAuthSnapshot({ provider: provider(null), storage, online: false });
  assert.deepEqual(snapshot, { state: "OFFLINE_SESSION", user });
});
