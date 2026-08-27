import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive, scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { FAVORITE_WEATHER_PLACES_STORAGE_KEY } from "./favoriteWeatherPlaces.ts";
import { applyFavoriteWeatherPlaceFromCloudWithoutEnqueue } from "./favoriteWeatherPlaces.ts";
import { repairFavoriteWeatherTombstoneIdentityCollision } from "./favoriteWeatherIdentityRepair.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";
import { WEATHER_PREFERENCES_STORAGE_KEY } from "./weatherPreferencesStorage.ts";
import { BrowserCloudSyncPayloadProvider } from "./cloudSyncBrowser.ts";
import { CloudSyncService, MemoryCloudSyncIssueRepository } from "./cloudSyncService.ts";

const scope = "USER:repair-user";
const oldId = "103178767";
const localSyncId = "11111111-1111-4111-8111-111111111111";
const cloudSyncId = "22222222-2222-4222-8222-222222222222";
const replacementId = "33333333-3333-4333-8333-333333333333";
const now = "2026-08-27T10:00:00.000Z";

function memoryStorage() {
  const values = new Map();
  return { values, get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null, key: (index) => [...values.keys()][index] ?? null, removeItem: (key) => values.delete(key), setItem: (key, value) => values.set(key, String(value)) };
}

test("un tombstone BC CLOUD TEST avec un autre syncId réattribue Bondues sans ressusciter l'ancien ID", async () => {
  const storage = memoryStorage();
  globalThis.window = { localStorage: storage, dispatchEvent() {} };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "repair-user", email: "repair@example.com", firstName: "", lastName: "" } });
  storage.setItem(scopedBusinessStorageKey(scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY), JSON.stringify({ version: 1, favorites: [{ id: oldId, syncId: localSyncId, name: "Bondues", latitude: 50.7, longitude: 3.1, createdAt: now, updatedAt: now }] }));
  storage.setItem(scopedBusinessStorageKey(scope, WEATHER_PREFERENCES_STORAGE_KEY), JSON.stringify({ favoriteWeatherLocationId: oldId, weatherModel: "arome_france" }));
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: (() => { let count = 0; return () => `mutation-${++count}`; })(), now: () => now } });
  const oldMutation = await outbox.enqueue({ entityType: "favorite-weather-place", entityId: oldId, operation: "UPSERT", baseRevision: 1 });
  await outbox.updateMutation(oldMutation.mutationId, { lastErrorCode: "CONFLICT" });
  const row = { id: oldId, userId: "repair-user", syncId: cloudSyncId, name: "BC CLOUD TEST", latitude: 50.7, longitude: 3.1, revision: 1, createdAt: now, updatedAt: now, deletedAt: now };

  const result = await repairFavoriteWeatherTombstoneIdentityCollision({ scope, storage, outbox, row, pending: await outbox.list(), createId: () => replacementId });
  assert.deepEqual(result, { repaired: true, oldEntityId: oldId, newEntityId: replacementId });
  const local = JSON.parse(storage.getItem(scopedBusinessStorageKey(scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY))).favorites;
  assert.deepEqual(local, [{ id: replacementId, syncId: replacementId, sourceId: oldId, name: "Bondues", latitude: 50.7, longitude: 3.1, createdAt: now, updatedAt: now }]);
  assert.equal(JSON.parse(storage.getItem(scopedBusinessStorageKey(scope, WEATHER_PREFERENCES_STORAGE_KEY))).favoriteWeatherLocationId, replacementId);
  assert.deepEqual((await outbox.list()).map(({ entityType, entityId, operation, baseRevision }) => ({ entityType, entityId, operation, baseRevision })), [
    { entityType: "favorite-weather-place", entityId: replacementId, operation: "UPSERT", baseRevision: 0 },
    { entityType: "weather-preferences", entityId: "singleton", operation: "UPSERT", baseRevision: 0 },
  ]);
  assert.equal((await repairFavoriteWeatherTombstoneIdentityCollision({ scope, storage, outbox, row, pending: await outbox.list(), createId: () => replacementId })).repaired, false);

  const cloud = new Map([[oldId, row]]);
  const push = new CloudSyncService({
    outbox,
    issues: new MemoryCloudSyncIssueRepository(),
    getScope: () => scope,
    getOnlineUserId: async () => "repair-user",
    buildPayload: (mutation) => new BrowserCloudSyncPayloadProvider(storage, scope).build(mutation),
    applyMutation: async (request) => {
      cloud.set(request.entityId, { id: request.entityId, userId: "repair-user", syncId: request.payload.sync_id, name: request.payload.name, latitude: request.payload.latitude, longitude: request.payload.longitude, revision: 0, createdAt: now, updatedAt: now, deletedAt: null });
      return { status: "APPLIED", entityId: request.entityId, revision: 0, serverUpdatedAt: now, deletedAt: null };
    },
  });
  assert.equal((await push.syncPendingMutations()).applied, 2);
  assert.equal((await outbox.getMetadata("favorite-weather-place", replacementId)).revision, 0);
  assert.equal(cloud.get(oldId).deletedAt, now);
  assert.equal(cloud.get(replacementId).name, "Bondues");
  const secondStorage = memoryStorage();
  globalThis.window = { localStorage: secondStorage, dispatchEvent() {} };
  applyFavoriteWeatherPlaceFromCloudWithoutEnqueue(scope, cloud.get(replacementId), secondStorage);
  applyFavoriteWeatherPlaceFromCloudWithoutEnqueue(scope, cloud.get(replacementId), secondStorage);
  assert.deepEqual(JSON.parse(secondStorage.getItem(scopedBusinessStorageKey(scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY))).favorites.map(({ id, name }) => ({ id, name })), [{ id: replacementId, name: "Bondues" }]);
  delete globalThis.window;
});

test("une différence de nom sans preuve syncId distincte ne répare jamais", async () => {
  const storage = memoryStorage();
  globalThis.window = { localStorage: storage, dispatchEvent() {} };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "repair-user", email: "repair@example.com", firstName: "", lastName: "" } });
  storage.setItem(scopedBusinessStorageKey(scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY), JSON.stringify({ version: 1, favorites: [{ id: oldId, name: "Bondues", latitude: 50.7, longitude: 3.1, createdAt: now, updatedAt: now }] }));
  const outbox = new MemorySyncOutboxStorage();
  const pending = await outbox.enqueue({ entityType: "favorite-weather-place", entityId: oldId, operation: "UPSERT" });
  const row = { id: oldId, userId: "repair-user", syncId: cloudSyncId, name: "BC CLOUD TEST", latitude: 50.7, longitude: 3.1, revision: 1, createdAt: now, updatedAt: now, deletedAt: now };
  assert.equal((await repairFavoriteWeatherTombstoneIdentityCollision({ scope, storage, outbox, row, pending: [pending], createId: () => replacementId })).repaired, false);
  delete globalThis.window;
});
