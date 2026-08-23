import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setRuntimeAuthSnapshot, scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { CloudPullService } from "./cloudPullService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";
import { applyUnitPreferencesFromCloudWithoutEnqueue, UNIT_PREFERENCES_STORAGE_KEY } from "./unitPreferencesStorage.ts";
import { applyWeatherPreferencesFromCloudWithoutEnqueue, WEATHER_PREFERENCES_STORAGE_KEY } from "./weatherPreferencesStorage.ts";
import { applyAviationPreferencesFromCloudWithoutEnqueue, AVIATION_PREFERENCES_STORAGE_KEY } from "./aviation/aviationPreferencesStorage.ts";

const scope = "USER:user-1";
const now = "2026-08-23T14:00:00.000Z";
const domains = ["unit-preferences", "weather-preferences", "aviation-preferences"];
const cloudId = (domain) => domain === "unit-preferences" ? "units" : domain === "weather-preferences" ? "weather" : "aviation";
const value = (domain) => domain === "unit-preferences"
  ? { weather: { windSpeedUnit: "kt", temperatureUnit: "°F" }, flightInstruments: { speedUnit: "kt", altitudeUnit: "ft", distanceUnit: "NM" } }
  : domain === "weather-preferences"
    ? { favoriteWeatherLocationId: "cloud-place", weatherModel: "icon_seamless" }
    : { airportIcao: "LFPG", favorites: [{ icao: "LFPG", name: "Paris CDG" }] };
const row = (domain, overrides = {}) => ({ id: cloudId(domain), entityId: "singleton", userId: "user-1", revision: 0, createdAt: now, updatedAt: now, deletedAt: null, value: value(domain), ...overrides });

class CursorRepository {
  values = new Map();
  async get(_scope, domain) { return this.values.get(domain) ?? null; }
  async set(_scope, domain, cursor) { this.values.set(domain, cursor); }
}

function context(rowsByDomain = Object.fromEntries(domains.map((domain) => [domain, [row(domain)]]))) {
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => crypto.randomUUID(), now: () => now } });
  const cursors = new CursorRepository();
  const applied = Object.fromEntries(domains.map((domain) => [domain, []]));
  const conflicts = [];
  let currentScope = scope;
  const adapter = (domain) => ({
    readPage: async (cursor, limit) => (rowsByDomain[domain] ?? []).filter((candidate) => !cursor || candidate.updatedAt > cursor.updatedAt || (candidate.updatedAt === cursor.updatedAt && candidate.id > cursor.id)).slice(0, limit),
    applyLocally: async (cloud) => { applied[domain].push(cloud); return true; },
  });
  const deps = {
    scope,
    getScope: () => currentScope,
    getOnlineUserId: async () => "user-1",
    outbox,
    cursors,
    readPage: async () => [],
    applyLocally: () => false,
    preferenceDomains: Object.fromEntries(domains.map((domain) => [domain, adapter(domain)])),
    recordConflict: async (conflict) => conflicts.push(conflict),
  };
  return { deps, outbox, cursors, applied, conflicts, switchUser: () => { currentScope = "USER:user-2"; } };
}

const pull = (service, domain) => domain === "unit-preferences" ? service.pullUnitPreferences()
  : domain === "weather-preferences" ? service.pullWeatherPreferences()
    : service.pullAviationPreferences();

test("les trois singletons actifs hydratent un appareil vierge sans outbox et avec sidecar exact", async () => {
  for (const domain of domains) {
    const ctx = context();
    const result = await pull(new CloudPullService(ctx.deps), domain);
    assert.equal(result.state, "COMPLETED");
    assert.equal(result.applied, 1);
    assert.equal(ctx.applied[domain].length, 1);
    assert.equal((await ctx.outbox.list()).length, 0);
    assert.deepEqual(await ctx.outbox.getMetadata(domain, "singleton"), { entityType: domain, entityId: "singleton", revision: 0, updatedAt: now });
  }
});

test("les imports silencieux remplacent puis réinitialisent les trois stockages sans enqueue", () => {
  const values = new Map();
  const events = [];
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, item) => values.set(key, item), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: storage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-1", email: "pull@example.test", firstName: "", lastName: "" } });
  const cases = [
    [UNIT_PREFERENCES_STORAGE_KEY, applyUnitPreferencesFromCloudWithoutEnqueue, value("unit-preferences")],
    [WEATHER_PREFERENCES_STORAGE_KEY, applyWeatherPreferencesFromCloudWithoutEnqueue, value("weather-preferences")],
    [AVIATION_PREFERENCES_STORAGE_KEY, applyAviationPreferencesFromCloudWithoutEnqueue, value("aviation-preferences")],
  ];
  for (const [key, apply, snapshot] of cases) {
    assert.equal(apply(scope, snapshot, false, storage), true);
    assert.notEqual(values.get(scopedBusinessStorageKey(scope, key)), undefined);
    assert.equal(apply(scope, snapshot, true, storage), true);
    assert.equal(values.get(scopedBusinessStorageKey(scope, key)), undefined);
  }
  assert.equal(events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("les tombstones des trois singletons suppriment localement et conservent le sidecar", async () => {
  for (const domain of domains) {
    const ctx = context({ [domain]: [row(domain, { revision: 3, deletedAt: now })] });
    const result = await pull(new CloudPullService(ctx.deps), domain);
    assert.equal(result.tombstonesApplied, 1);
    assert.equal((await ctx.outbox.getMetadata(domain, "singleton")).deletedAt, now);
    assert.equal((await ctx.outbox.list()).length, 0);
  }
});

test("un pull répété est idempotent pour chacun des trois singletons", async () => {
  for (const domain of domains) {
    const ctx = context();
    const service = new CloudPullService(ctx.deps);
    assert.equal((await pull(service, domain)).applied, 1);
    assert.equal((await pull(service, domain)).applied, 0);
    assert.equal(ctx.applied[domain].length, 1);
  }
});

test("pending à révision égale est préservé et pending ancien devient conflit", async () => {
  for (const domain of domains) {
    const equal = context({ [domain]: [row(domain, { revision: 2 })] });
    await equal.outbox.setMetadata({ entityType: domain, entityId: "singleton", revision: 2, updatedAt: now });
    await equal.outbox.enqueue({ entityType: domain, entityId: "singleton", operation: "UPSERT", baseRevision: 2 });
    const preserved = await pull(new CloudPullService(equal.deps), domain);
    assert.equal(preserved.preservedLocalPending, 1);
    assert.equal(preserved.conflicts.length, 0);

    const stale = context({ [domain]: [row(domain, { revision: 2 })] });
    await stale.outbox.setMetadata({ entityType: domain, entityId: "singleton", revision: 1, updatedAt: now });
    await stale.outbox.enqueue({ entityType: domain, entityId: "singleton", operation: "UPSERT", baseRevision: 1 });
    const conflict = await pull(new CloudPullService(stale.deps), domain);
    assert.equal(conflict.conflicts[0].reason, "REMOTE_ADVANCED");
    assert.equal((await stale.outbox.list()).length, 1);
  }
});

test("tombstone pending, collision locale et révision Cloud inférieure sont protégés", async () => {
  for (const domain of domains) {
    const tombstone = context({ [domain]: [row(domain, { revision: 1, deletedAt: now })] });
    await tombstone.outbox.setMetadata({ entityType: domain, entityId: "singleton", revision: 1, updatedAt: now });
    await tombstone.outbox.enqueue({ entityType: domain, entityId: "singleton", operation: "UPSERT", baseRevision: 1 });
    assert.equal((await pull(new CloudPullService(tombstone.deps), domain)).conflicts[0].reason, "REMOTE_TOMBSTONE");

    const collision = context();
    const historical = { mutationId: `${domain}-collision`, entityType: domain, entityId: "singleton", operation: "UPSERT", baseRevision: 0, createdAt: now, attempts: 0 };
    collision.deps.outbox = new MemorySyncOutboxStorage({ mutations: new Map([[historical.mutationId, historical]]) });
    assert.equal((await pull(new CloudPullService(collision.deps), domain)).conflicts[0].reason, "LOCAL_CREATION_COLLISION");

    const behind = context({ [domain]: [row(domain, { revision: 1 })] });
    await behind.outbox.setMetadata({ entityType: domain, entityId: "singleton", revision: 2, updatedAt: now });
    assert.equal((await pull(new CloudPullService(behind.deps), domain)).state, "BLOCKED_ANOMALY");
  }
});

test("GUEST et USER switch protègent chaque singleton", async () => {
  for (const domain of domains) {
    const guest = context(); guest.deps.scope = "GUEST"; guest.deps.getScope = () => "GUEST";
    assert.equal((await pull(new CloudPullService(guest.deps), domain)).state, "REFUSED_GUEST");
    const switched = context(); let checks = 0; switched.deps.getScope = () => (++checks >= 4 ? "USER:user-2" : scope);
    assert.equal((await pull(new CloudPullService(switched.deps), domain)).state, "STOPPED_USER_SWITCH");
    assert.equal(switched.applied[domain].length, 0);
  }
});

test("units et weather partagent la table mais jamais leur curseur canonique", async () => {
  const ctx = context();
  const service = new CloudPullService(ctx.deps);
  await service.pullUnitPreferences();
  await service.pullWeatherPreferences();
  assert.deepEqual(ctx.cursors.values.get("unit-preferences"), { updatedAt: now, id: "units" });
  assert.deepEqual(ctx.cursors.values.get("weather-preferences"), { updatedAt: now, id: "weather" });
  assert.equal(ctx.cursors.values.has("aviation-preferences"), false);
});

test("le Pull préférences ne touche aucun domaine CRUD et n’appelle jamais le rebase", async () => {
  const ctx = context();
  await ctx.outbox.enqueue({ entityType: "balloon", entityId: "balloon-1", operation: "UPSERT" });
  await new CloudPullService(ctx.deps).pullUnitPreferences();
  assert.equal((await ctx.outbox.list()).filter(({ entityType }) => entityType === "balloon").length, 1);
  const source = readFileSync(new URL("./cloudPullService.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /resolveProtectedPreferenceConflictLocalWins|rebase/i);
});

test("les helpers DEV et l’inspection restent ciblés sans auto-pull", () => {
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  for (const helper of ["pullUnitPreferencesTargeted", "pullWeatherPreferencesTargeted", "pullAviationPreferencesTargeted", "inspectPreferencePullState"]) assert.match(runtime, new RegExp(helper));
  const inspection = runtime.match(/async function inspectPreferencePullState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(inspection, /syncMutationById|syncPendingMutations|\.rpc\(|\.enqueue\(|\.setMetadata\(|save[A-Z]/);
  assert.doesNotMatch(runtime.match(/const schedule = \(delay = 750\)[\s\S]*?return \(\) =>/)?.[0] ?? "", /pullUnitPreferences|pullWeatherPreferences|pullAviationPreferences/);
});

test("l’adaptateur utilise les mappings Cloud canoniques sous SELECT uniquement", () => {
  const browser = readFileSync(new URL("./cloudPullBrowser.ts", import.meta.url), "utf8");
  assert.match(browser, /"aviation_preferences" : "user_preferences"/);
  assert.match(browser, /"aviation" : input\.domain === "unit-preferences" \? "units" : "weather"/);
  assert.match(browser, /\.select\(select\)\.eq\("id", id\)/);
  assert.match(browser, /applyUnitPreferencesFromCloudWithoutEnqueue/);
  assert.match(browser, /applyWeatherPreferencesFromCloudWithoutEnqueue/);
  assert.match(browser, /applyAviationPreferencesFromCloudWithoutEnqueue/);
  assert.doesNotMatch(browser, /\.rpc\(|\.insert\(|\.upsert\(|resolveProtectedPreferenceConflictLocalWins/);
});
