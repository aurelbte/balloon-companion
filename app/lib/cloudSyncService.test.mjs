import test from "node:test";
import assert from "node:assert/strict";
import {
  CloudSyncService,
  CloudSyncTransportError,
  MemoryCloudSyncIssueRepository,
  cloudSyncBackoffMs,
  nextEligibleRetryAt,
} from "./cloudSyncService.ts";
import { BrowserCloudSyncPayloadProvider, scanInitialCloudSyncInventory } from "./cloudSyncBrowser.ts";
import { scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";
import { PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";
import { FAVORITE_WEATHER_PLACES_STORAGE_KEY } from "./favoriteWeatherPlaces.ts";
import { BALLOON_REGISTRY_STORAGE_KEY } from "./balloonStorage.ts";
import { PILOT_QUALIFICATIONS_STORAGE_KEY } from "./pilotQualificationsStorage.ts";
import { CONTROLLED_CLOUD_SYNC_SESSION_KEY, createScopeUnavailableControlledApi, isAutomaticCloudSyncBlockedForControlledTest } from "./cloudSyncTestControl.ts";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-08-18T15:00:00.000Z");

test("nextEligibleRetryAt est read-only et ignore conflit, local-only et date invalide", () => {
  const mutations = [
    { mutationId: "retry", entityType: "flight", entityId: "f", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 1, lastErrorCode: "NETWORK", nextAttemptAt: "2026-08-18T15:01:00.000Z" },
    { mutationId: "later", entityType: "balloon", entityId: "b", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 1, lastErrorCode: "SERVER", nextAttemptAt: "2026-08-18T15:02:00.000Z" },
    { mutationId: "conflict", entityType: "flight", entityId: "c", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 1, lastErrorCode: "CONFLICT", nextAttemptAt: "2026-08-18T15:00:30.000Z" },
    { mutationId: "local", entityType: "flight-completion", entityId: "singleton", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 1, nextAttemptAt: "2026-08-18T15:00:10.000Z" },
  ];
  const snapshot = structuredClone(mutations);
  assert.equal(nextEligibleRetryAt(mutations), "2026-08-18T15:01:00.000Z");
  assert.deepEqual(mutations, snapshot);
});

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key) { return this.values.get(key) ?? null; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  removeItem(key) { this.values.delete(key); }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function fixture(input = {}) {
  const outbox = input.outbox ?? new MemorySyncOutboxStorage({ dependencies: {
    createId: (() => { let id = 1; return () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`; })(),
    now: () => NOW.toISOString(),
  } });
  const issues = new MemoryCloudSyncIssueRepository();
  let scope = input.scope ?? `USER:${USER_A}`;
  let calls = 0;
  const requests = [];
  const service = new CloudSyncService({
    outbox,
    issues,
    getScope: () => scope,
    getOnlineUserId: async () => input.onlineUserId === undefined ? USER_A : input.onlineUserId,
    buildPayload: async (mutation) => ({ serverEntityType: mutation.entityType === "pilot-profile" ? "profile" : mutation.entityType, serverEntityId: mutation.entityId, payload: { first_name: "Alice" } }),
    applyMutation: async (request) => {
      calls += 1;
      requests.push(request);
      if (input.apply) return input.apply(request, { setScope: (value) => { scope = value; } });
      return { status: "APPLIED", entityId: request.entityId, revision: 0, serverUpdatedAt: NOW.toISOString(), deletedAt: null };
    },
    now: () => NOW,
  });
  return { outbox, issues, service, calls: () => calls, requests, setScope: (value) => { scope = value; } };
}

test("GUEST reste local et ne produit aucun appel réseau", async () => {
  const value = fixture({ scope: "GUEST" });
  await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).state, "SKIPPED_GUEST");
  assert.equal(value.calls(), 0);
  assert.equal((await value.outbox.list()).length, 1);
});

test("un USER sans session online conserve toute sa mutation", async () => {
  const value = fixture({ onlineUserId: null });
  await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).state, "SKIPPED_NO_ONLINE_SESSION");
  assert.equal(value.calls(), 0);
  assert.equal((await value.outbox.list()).length, 1);
});

test("APPLIED met à jour le sidecar avant de retirer l outbox", async () => {
  const value = fixture();
  await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT" });
  const result = await value.service.syncPendingMutations();
  assert.equal(result.applied, 1);
  assert.equal((await value.outbox.list()).length, 0);
  assert.deepEqual(await value.outbox.getMetadata("pilot-profile", "singleton"), {
    entityType: "pilot-profile", entityId: "singleton", revision: 0, updatedAt: NOW.toISOString(),
  });
});

test("ALREADY_APPLIED nettoie un replay après crash", async () => {
  const value = fixture({ apply: async (request) => ({ status: "ALREADY_APPLIED", entityId: request.entityId, revision: 4, serverUpdatedAt: NOW.toISOString(), deletedAt: null }) });
  await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).applied, 1);
  assert.equal((await value.outbox.list()).length, 0);
  assert.equal((await value.outbox.getMetadata("pilot-profile", "singleton")).revision, 4);
});

test("CONFLICT conserve mutation et contexte serveur sans écraser le local", async () => {
  const value = fixture({ apply: async (request) => ({ status: "CONFLICT", entityId: request.entityId, revision: 7, serverUpdatedAt: NOW.toISOString(), deletedAt: null }) });
  await value.outbox.enqueue({ entityType: "balloon", entityId: "balloon-conflict", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).conflicts, 1);
  assert.equal((await value.outbox.list()).length, 1);
  assert.deepEqual((await value.issues.list()).map(({ kind, serverRevision }) => ({ kind, serverRevision })), [{ kind: "CONFLICT", serverRevision: 7 }]);
});

test("NOT_FOUND garde un diagnostic mais retire le DELETE terminal", async () => {
  const value = fixture({ apply: async (request) => ({ status: "NOT_FOUND", entityId: request.entityId, revision: null, serverUpdatedAt: null, deletedAt: null }) });
  await value.outbox.enqueue({ entityType: "favorite-weather-place", entityId: "missing", operation: "DELETE" });
  assert.equal((await value.service.syncPendingMutations()).notFound, 1);
  assert.equal((await value.outbox.list()).length, 0);
  assert.equal((await value.issues.list())[0].kind, "NOT_FOUND");
});

test("une erreur réseau conserve la mutation avec attempts et backoff", async () => {
  const value = fixture({ apply: async () => { throw new CloudSyncTransportError("NETWORK", "offline"); } });
  await value.outbox.enqueue({ entityType: "weather-preferences", entityId: "singleton", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).state, "STOPPED_ERROR");
  const [mutation] = await value.outbox.list();
  assert.equal(mutation.attempts, 1);
  assert.equal(mutation.lastErrorCode, "NETWORK");
  assert.equal(mutation.nextAttemptAt, new Date(NOW.getTime() + cloudSyncBackoffMs(1)).toISOString());
  await value.service.syncPendingMutations();
  assert.equal(value.calls(), 1, "le prochain trigger n attend pas activement et respecte nextAttemptAt");
});

test("une erreur Auth arrête la passe sans programmer un backoff agressif", async () => {
  const value = fixture({ apply: async () => { throw new CloudSyncTransportError("AUTH", "expired"); } });
  await value.outbox.enqueue({ entityType: "aviation-preferences", entityId: "singleton", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).state, "SKIPPED_NO_ONLINE_SESSION");
  const [mutation] = await value.outbox.list();
  assert.equal(mutation.attempts, 1);
  assert.equal(mutation.nextAttemptAt, undefined);
});

test("un changement USER A vers USER B invalide la passe avant nettoyage local", async () => {
  const value = fixture({ apply: async (request, control) => {
    control.setScope(`USER:${USER_B}`);
    return { status: "APPLIED", entityId: request.entityId, revision: 0, serverUpdatedAt: NOW.toISOString(), deletedAt: null };
  } });
  await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).state, "STOPPED_USER_SWITCH");
  assert.equal((await value.outbox.list()).length, 1);
});

test("les domaines non transportés restent ignorés sans suppression", async () => {
  const value = fixture();
  for (const entityType of ["recorded-flight", "flight-completion"]) {
    await value.outbox.enqueue({ entityType, entityId: entityType, operation: "UPSERT" });
  }
  const result = await value.service.syncPendingMutations();
  assert.equal(result.ignored, 2);
  assert.equal(value.calls(), 0);
  assert.equal((await value.outbox.list()).length, 2);
});

test("le drain automatique traite les domaines métier et préférences de compte dans l'ordre de dépendance", async () => {
  const value = fixture();
  for (const [entityType, entityId] of [["balloon-document", "document"], ["logbook-entry", "entry"], ["flight", "flight"], ["balloon-preferences", "singleton"], ["balloon", "balloon"], ["pilot-qualifications", "singleton"]]) {
    await value.outbox.enqueue({ entityType, entityId, operation: "UPSERT" });
  }
  assert.equal((await value.service.syncPendingMutations()).applied, 6);
  assert.deepEqual(value.requests.map(({ entityType }) => entityType), ["pilot-qualifications", "balloon", "balloon-preferences", "flight", "logbook-entry", "balloon-document"]);
  assert.deepEqual(await value.outbox.list(), []);
});

test("un parent balloon en erreur conserve le parent et sa dépendance non tentée", async () => {
  const value = fixture({ apply: async (request) => {
    if (request.entityType === "balloon") throw new CloudSyncTransportError("SERVER", "parent unavailable");
    return { status: "APPLIED", entityId: request.entityId, revision: 0, serverUpdatedAt: NOW.toISOString(), deletedAt: null };
  } });
  const document = await value.outbox.enqueue({ entityType: "balloon-document", entityId: "document", operation: "UPSERT" });
  const balloon = await value.outbox.enqueue({ entityType: "balloon", entityId: "balloon", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).state, "STOPPED_ERROR");
  const remaining = await value.outbox.list();
  assert.equal(remaining.find(({ mutationId }) => mutationId === balloon.mutationId).attempts, 1);
  assert.equal(remaining.find(({ mutationId }) => mutationId === document.mutationId).attempts, 0);
});

test("le payload profil et favori exclut trace, document et Blob", async () => {
  const storage = new MemoryStorage();
  const scope = `USER:${USER_A}`;
  storage.setItem(scopedBusinessStorageKey(scope, PILOT_PROFILE_STORAGE_KEY), JSON.stringify({ version: 1, firstName: "Alice", lastName: "Pilote", licenseNumber: "FRA", usualFunction: "Pilote", flightTestDueDateIso: "", medicalDueDateIso: "" }));
  storage.setItem(scopedBusinessStorageKey(scope, FAVORITE_WEATHER_PLACES_STORAGE_KEY), JSON.stringify({ version: 1, favorites: [{ id: "wx", name: "Lille", latitude: 50.6, longitude: 3.1, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }] }));
  const provider = new BrowserCloudSyncPayloadProvider(storage, scope);
  const profile = await provider.build({ mutationId: "x", entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 0 });
  const favorite = await provider.build({ mutationId: "y", entityType: "favorite-weather-place", entityId: "wx", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 0 });
  const serialized = JSON.stringify([profile, favorite]);
  for (const forbidden of ["points", "trace", "blob", "object_key", "storage_provider", "document"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});

test("le payload balloon reste structuré et exclut documents, traces et Blob", async () => {
  const storage = new MemoryStorage();
  const scope = `USER:${USER_A}`;
  storage.setItem(scopedBusinessStorageKey(scope, BALLOON_REGISTRY_STORAGE_KEY), JSON.stringify({ version: 5, activeBalloonId: "balloon-test", balloons: [{ id: "balloon-test", registration: "F-TEST", manufacturer: "Cameron", model: "Z105", category: "Libre à air chaud", volumeM3: 2973, applicableMtowKg: 952, configurationLimitsConfirmed: true, color: "Bleu", isFavorite: true, lastUsedAt: NOW.toISOString(), documents: [{ id: "forbidden" }], weights: { envelopeKg: 280, fullCylinders: [] } }] }));
  const payload = await new BrowserCloudSyncPayloadProvider(storage, scope).build({ mutationId: "balloon-mutation", entityType: "balloon", entityId: "balloon-test", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 0 });
  assert.equal(payload.serverEntityType, "balloon");
  assert.equal(payload.serverEntityId, "balloon-test");
  assert.equal(payload.payload.registration, "F-TEST");
  assert.equal(payload.payload.volume_m3, 2973);
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["document", "trace", "blob", "points", "object_key"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});

test("qualifications et ballon actif utilisent les lignes JSON user_preferences existantes", async () => {
  const storage = new MemoryStorage();
  const scope = `USER:${USER_A}`;
  storage.setItem(scopedBusinessStorageKey(scope, PILOT_QUALIFICATIONS_STORAGE_KEY), JSON.stringify({ version: 1, profile: { configured: true, licenceType: "BPL" }, events: [{ id: "11111111-1111-4111-8111-111111111111", type: "MEDICAL", dateIso: "2026-01-01", expiryDateIso: "2027-01-01", source: "MANUAL", medicalClass: "LAPL", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }] }));
  storage.setItem(scopedBusinessStorageKey(scope, BALLOON_REGISTRY_STORAGE_KEY), JSON.stringify({ version: 5, activeBalloonId: "balloon-cloud", balloons: [] }));
  const provider = new BrowserCloudSyncPayloadProvider(storage, scope);
  const qualifications = await provider.build({ mutationId: "q", entityType: "pilot-qualifications", entityId: "singleton", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 0 });
  const balloon = await provider.build({ mutationId: "b", entityType: "balloon-preferences", entityId: "singleton", operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 0 });
  assert.deepEqual([qualifications.serverEntityType, qualifications.serverEntityId], ["user_preferences", "qualifications"]);
  assert.equal(qualifications.payload.preferences.profile.configured, true);
  assert.equal(qualifications.payload.preferences.events[0].medicalClass, "LAPL");
  assert.deepEqual([balloon.serverEntityType, balloon.serverEntityId], ["user_preferences", "balloon"]);
  assert.equal(balloon.payload.preferences.activeBalloonId, "balloon-cloud");
});

test("le payload flight reste structuré sans points, trace, document ni Blob", async () => {
  const storage = new MemoryStorage();
  const scope = `USER:${USER_A}`;
  const flight = {
    id: "flight-test", schemaVersion: 1, status: "COMPLETED",
    startedAt: Date.parse("2026-08-21T08:00:00Z"), endedAt: Date.parse("2026-08-21T09:00:00Z"),
    points: [{ latitude: 50.7, longitude: 3.1 }],
    summary: { durationSeconds: 3600, distanceMeters: 12000, minAltitudeMeters: 20, maxAltitudeMeters: 800, averageGroundSpeedMetersPerSecond: 3.3, maxGroundSpeedMetersPerSecond: 7 },
    createdAt: NOW.getTime(), updatedAt: NOW.getTime(), balloonRegistration: "F-TEST", notes: "BC CLOUD TEST",
  };
  storage.setItem(scopedBusinessStorageKey(scope, "balloon-companion-flight-completion-v1"), JSON.stringify({ journalFlights: [{ id: "flight-test", sourceFlightId: "flight-test", generatedTitle: "BC CLOUD TEST", origin: "REAL_GPS", logbookStatus: "CARNET_PENDING" }] }));
  const provider = new BrowserCloudSyncPayloadProvider(storage, scope, async (id) => id === flight.id ? flight : null);
  const payload = await provider.build({ mutationId: "flight-mutation", entityType: "flight", entityId: flight.id, operation: "UPSERT", baseRevision: 0, createdAt: NOW.toISOString(), attempts: 0 });
  assert.equal(payload.serverEntityType, "flight");
  assert.equal(payload.payload.started_at, "2026-08-21T08:00:00.000Z");
  assert.equal(payload.payload.generated_title, "BC CLOUD TEST");
  assert.equal(payload.payload.notes, "BC CLOUD TEST");
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["points", "trace", "document", "blob", "object_key", "storage_provider", "checksum"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
  assert.equal(Object.hasOwn(payload.payload, "points"), false);
  assert.equal(Object.hasOwn(payload.payload, "trace"), false);
});

test("un échec sidecar après confirmation garde la mutation pour replay", async () => {
  const base = new MemorySyncOutboxStorage({ dependencies: { createId: () => "00000000-0000-4000-8000-000000000099", now: () => NOW.toISOString() } });
  let fail = true;
  const outbox = new Proxy(base, { get(target, property) {
    if (property === "setMetadata") return async (metadata) => { if (fail) { fail = false; throw new Error("crash"); } return target.setMetadata(metadata); };
    const value = target[property];
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const value = fixture({ outbox, apply: async (request) => ({ status: fail ? "APPLIED" : "ALREADY_APPLIED", entityId: request.entityId, revision: 3, serverUpdatedAt: NOW.toISOString(), deletedAt: null }) });
  await outbox.enqueue({ entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT" });
  assert.equal((await value.service.syncPendingMutations()).state, "STOPPED_ERROR");
  assert.equal((await outbox.list()).length, 1);
  await outbox.updateMutation("00000000-0000-4000-8000-000000000099", { nextAttemptAt: NOW.toISOString() });
  assert.equal((await value.service.syncPendingMutations()).applied, 1);
  assert.equal((await outbox.list()).length, 0);
});

test("le scan initial est idempotent et ne crée aucune mutation", async () => {
  const storage = new MemoryStorage();
  const scope = `USER:${USER_A}`;
  storage.setItem(scopedBusinessStorageKey(scope, PILOT_PROFILE_STORAGE_KEY), JSON.stringify({ firstName: "Alice" }));
  const outbox = new MemorySyncOutboxStorage();
  const first = await scanInitialCloudSyncInventory({ storage, scope, outbox });
  const second = await scanInitialCloudSyncInventory({ storage, scope, outbox });
  assert.deepEqual(first, second);
  assert.deepEqual(first, [{ entityType: "pilot-profile", entityId: "singleton", alreadyKnownLocally: false }]);
  assert.equal((await outbox.list()).length, 0);
});

test("syncMutationById envoie uniquement TEST et laisse A et B strictement intactes", async () => {
  const value = fixture();
  const a = await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "a", operation: "UPSERT" });
  const target = await value.outbox.enqueue({ entityType: "favorite-weather-place", entityId: "test", operation: "UPSERT" });
  const b = await value.outbox.enqueue({ entityType: "unit-preferences", entityId: "b", operation: "UPSERT" });
  assert.equal((await value.service.syncMutationById(target.mutationId)).applied, 1);
  assert.deepEqual(value.requests.map(({ mutationId }) => mutationId), [target.mutationId]);
  assert.deepEqual(await value.outbox.list(), [a, b]);
  assert.equal(await value.outbox.getMetadata("pilot-profile", "a").then((item) => item.attempts), undefined);
  assert.equal((await value.outbox.getMetadata("favorite-weather-place", "test")).revision, 0);
});

test("syncMutationById conserve uniquement TEST en conflit", async () => {
  const value = fixture({ apply: async (request) => ({ status: "CONFLICT", entityId: request.entityId, revision: 2, serverUpdatedAt: NOW.toISOString(), deletedAt: null }) });
  const a = await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "a", operation: "UPSERT" });
  const target = await value.outbox.enqueue({ entityType: "favorite-weather-place", entityId: "test", operation: "UPSERT" });
  const b = await value.outbox.enqueue({ entityType: "weather-preferences", entityId: "b", operation: "UPSERT" });
  assert.equal((await value.service.syncMutationById(target.mutationId)).conflicts, 1);
  const remaining = await value.outbox.list();
  assert.deepEqual(remaining.map(({ mutationId }) => mutationId), [a.mutationId, target.mutationId, b.mutationId]);
  assert.equal(remaining[0].attempts, 0);
  assert.equal(remaining[1].attempts, 1);
  assert.equal(remaining[2].attempts, 0);
});

test("syncMutationById nettoie ALREADY_APPLIED et applique la politique NOT_FOUND", async () => {
  for (const status of ["ALREADY_APPLIED", "NOT_FOUND"]) {
    const value = fixture({ apply: async (request) => status === "ALREADY_APPLIED"
      ? { status, entityId: request.entityId, revision: 3, serverUpdatedAt: NOW.toISOString(), deletedAt: null }
      : { status, entityId: request.entityId, revision: null, serverUpdatedAt: null, deletedAt: null } });
    const target = await value.outbox.enqueue({ entityType: "favorite-weather-place", entityId: status, operation: status === "NOT_FOUND" ? "DELETE" : "UPSERT" });
    const result = await value.service.syncMutationById(target.mutationId);
    assert.equal((await value.outbox.list()).length, 0);
    assert.equal(status === "ALREADY_APPLIED" ? result.applied : result.notFound, 1);
  }
});

test("syncMutationById applique retry et backoff uniquement à TEST", async () => {
  const value = fixture({ apply: async () => { throw new CloudSyncTransportError("NETWORK", "offline"); } });
  const a = await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "a", operation: "UPSERT" });
  const target = await value.outbox.enqueue({ entityType: "favorite-weather-place", entityId: "test", operation: "UPSERT" });
  const b = await value.outbox.enqueue({ entityType: "aviation-preferences", entityId: "b", operation: "UPSERT" });
  assert.equal((await value.service.syncMutationById(target.mutationId)).state, "STOPPED_ERROR");
  const remaining = await value.outbox.list();
  assert.deepEqual(remaining.map(({ mutationId, attempts, nextAttemptAt }) => ({ mutationId, attempts, nextAttemptAt })), [
    { mutationId: a.mutationId, attempts: 0, nextAttemptAt: undefined },
    { mutationId: target.mutationId, attempts: 1, nextAttemptAt: new Date(NOW.getTime() + cloudSyncBackoffMs(1)).toISOString() },
    { mutationId: b.mutationId, attempts: 0, nextAttemptAt: undefined },
  ]);
});

test("syncMutationById inexistant ne dépile rien", async () => {
  const value = fixture();
  const existing = await value.outbox.enqueue({ entityType: "pilot-profile", entityId: "a", operation: "UPSERT" });
  assert.equal((await value.service.syncMutationById("absent")).state, "COMPLETED");
  assert.equal(value.calls(), 0);
  assert.deepEqual(await value.outbox.list(), [existing]);
});

test("syncMutationById reste sans réseau pour GUEST et session offline", async () => {
  for (const value of [fixture({ scope: "GUEST" }), fixture({ onlineUserId: null })]) {
    const target = await value.outbox.enqueue({ entityType: "favorite-weather-place", entityId: "test", operation: "UPSERT" });
    await value.service.syncMutationById(target.mutationId);
    assert.equal(value.calls(), 0);
    assert.deepEqual(await value.outbox.list(), [target]);
  }
});

test("syncMutationById refuse un domaine interdit sans supprimer sa mutation", async () => {
  const value = fixture();
  const target = await value.outbox.enqueue({ entityType: "recorded-flight", entityId: "flight", operation: "UPSERT" });
  assert.equal((await value.service.syncMutationById(target.mutationId)).ignored, 1);
  assert.equal(value.calls(), 0);
  assert.deepEqual(await value.outbox.list(), [target]);
});

test("syncMutationById protège le scope lors d un USER switch", async () => {
  const value = fixture({ apply: async (request, control) => {
    control.setScope(`USER:${USER_B}`);
    return { status: "APPLIED", entityId: request.entityId, revision: 0, serverUpdatedAt: NOW.toISOString(), deletedAt: null };
  } });
  const target = await value.outbox.enqueue({ entityType: "favorite-weather-place", entityId: "test", operation: "UPSERT" });
  assert.equal((await value.service.syncMutationById(target.mutationId)).state, "STOPPED_USER_SWITCH");
  assert.deepEqual(await value.outbox.list(), [{ ...target, attempts: 1 }]);
  assert.equal((await value.outbox.getMetadata(target.entityType, target.entityId)).revision, 0);
});

test("la protection ciblée est explicite par URL en développement comme en production", () => {
  assert.equal(isAutomaticCloudSyncBlockedForControlledTest("development", "?cloudSyncTest=targeted"), true);
  assert.equal(isAutomaticCloudSyncBlockedForControlledTest("production", "?cloudSyncTest=targeted"), true);
  assert.equal(isAutomaticCloudSyncBlockedForControlledTest("development", ""), false);
  assert.equal(isAutomaticCloudSyncBlockedForControlledTest("production", ""), false);
});

test("la PWA peut activer targeted explicitement pour la session seulement", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null };
  assert.equal(isAutomaticCloudSyncBlockedForControlledTest("production", "", storage), false);
  values.set(CONTROLLED_CLOUD_SYNC_SESSION_KEY, "targeted");
  assert.equal(isAutomaticCloudSyncBlockedForControlledTest("production", "", storage), true);
  values.set(CONTROLLED_CLOUD_SYNC_SESSION_KEY, "anything-else");
  assert.equal(isAutomaticCloudSyncBlockedForControlledTest("production", "", storage), false);
});

test("l API ciblée d attente existe mais refuse proprement tant que le scope est indisponible", async () => {
  const api = createScopeUnavailableControlledApi();
  assert.equal(typeof api.inspectFlightTrackR2TargetedState, "function");
  await assert.rejects(api.inspectFlightTrackR2TargetedState("flight-a"), /SCOPE_UNAVAILABLE/);
});
