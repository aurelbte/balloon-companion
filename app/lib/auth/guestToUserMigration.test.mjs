import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { guestBusinessStorageKey, scopedBusinessStorageKey } from "./dataScopeRuntime.ts";
import { GUEST_TO_USER_MIGRATION_KEY, migrateGuestAndLegacyToUser, selectAbsentMigrationRecords } from "./guestToUserMigration.ts";

function memoryStorage(entries = {}) { const values = new Map(Object.entries(entries)); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), snapshot: () => Object.fromEntries(values) }; }
function outbox(options = {}) { const mutations = []; let calls = 0; return { mutations, enqueue: async (value) => { calls += 1; if (calls === options.failAt) throw new Error("interrupted"); const existing = mutations.find((item) => item.entityType === value.entityType && item.entityId === value.entityId); if (!existing) mutations.push({ ...value, mutationId: `m-${calls}` }); return existing ?? mutations.at(-1); } }; }
const scope = "USER:user-1";
const key = (legacy) => scopedBusinessStorageKey(scope, legacy);
const guest = (legacy) => guestBusinessStorageKey(legacy);

test("premier login importe profil, préférences, ballons, Journal et ascensions sans supprimer GUEST", async () => {
  const entries = {
    [guest("balloon-companion-pilot-profile")]: JSON.stringify({ firstName: "Ada", licenseNumber: "BPL" }),
    [guest("balloon-companion-weather-preferences-v1")]: JSON.stringify({ favoriteWeatherLocationId: "w1", weatherModel: "gfs" }),
    [guest("balloon-companion-balloons")]: JSON.stringify({ version: 3, balloons: [{ id: "b1", registration: "F-ONE" }], activeBalloonId: "b1" }),
    [guest("balloon-companion-flight-completion-v1")]: JSON.stringify({ version: 2, openingBalance: { confirmed: true, ascensions: 4, officialDurationMinutes: 90 }, journalFlights: [{ id: "j1", sourceFlightId: "f1" }], officialAscensions: [{ id: "a1", sourceFlightId: "f1" }] }),
  };
  const storage = memoryStorage(entries), queue = outbox();
  const result = await migrateGuestAndLegacyToUser({ userId: "user-1", deviceId: "device-1", storage, outbox: queue });
  assert.equal(result.state, "COMPLETE");
  assert.equal(JSON.parse(storage.getItem(key("balloon-companion-pilot-profile"))).firstName, "Ada");
  assert.deepEqual(JSON.parse(storage.getItem(key("balloon-companion-balloons"))).balloons.map(({ id }) => id), ["b1"]);
  const completion = JSON.parse(storage.getItem(key("balloon-companion-flight-completion-v1")));
  assert.deepEqual(completion.journalFlights.map(({ sourceFlightId }) => sourceFlightId), ["f1"]);
  assert.deepEqual(completion.officialAscensions.map(({ id }) => id), ["a1"]);
  assert.equal(storage.getItem(guest("balloon-companion-flight-completion-v1")), entries[guest("balloon-companion-flight-completion-v1")]);
  assert.deepEqual(queue.mutations.map(({ entityType, entityId }) => [entityType, entityId]), [["pilot-profile", "singleton"], ["weather-preferences", "singleton"], ["balloon", "b1"], ["flight-completion", "singleton"], ["flight", "f1"], ["logbook-entry", "a1"]]);
});

test("merge additif protège IDs USER, sourceFlightId dupliqué et collisions", async () => {
  const storage = memoryStorage({
    [key("balloon-companion-balloons")]: JSON.stringify({ balloons: [{ id: "user-balloon", registration: "F-U" }] }),
    [guest("balloon-companion-balloons")]: JSON.stringify({ balloons: [{ id: "guest-balloon", registration: "F-G" }] }),
    [key("balloon-companion-flight-completion-v1")]: JSON.stringify({ openingBalance: { confirmed: true, ascensions: 1, officialDurationMinutes: 10 }, journalFlights: [{ id: "user-j", sourceFlightId: "same", departure: "USER" }], officialAscensions: [] }),
    [guest("balloon-companion-flight-completion-v1")]: JSON.stringify({ openingBalance: { confirmed: true, ascensions: 2, officialDurationMinutes: 20 }, journalFlights: [{ id: "guest-j", sourceFlightId: "same", departure: "GUEST" }, { id: "new", sourceFlightId: "new" }], officialAscensions: [] }),
  });
  const result = await migrateGuestAndLegacyToUser({ userId: "user-1", deviceId: "device-1", storage, outbox: outbox() });
  assert.equal(result.state, "COMPLETE_WITH_COLLISIONS");
  assert.deepEqual(JSON.parse(storage.getItem(key("balloon-companion-balloons"))).balloons.map(({ id }) => id), ["user-balloon", "guest-balloon"]);
  const journal = JSON.parse(storage.getItem(key("balloon-companion-flight-completion-v1"))).journalFlights;
  assert.deepEqual(journal.map(({ sourceFlightId }) => sourceFlightId), ["same", "new"]);
  assert.equal(journal[0].departure, "USER");
});

test("marker rend la migration idempotente et une interruption reprend sans perte", async () => {
  const storage = memoryStorage({ [guest("balloon-companion-pilot-profile")]: JSON.stringify({ firstName: "Ada" }), [guest("balloon-companion-balloons")]: JSON.stringify({ balloons: [{ id: "b1" }] }) });
  await assert.rejects(migrateGuestAndLegacyToUser({ userId: "user-1", deviceId: "device-1", storage, outbox: outbox({ failAt: 1 }) }));
  assert.equal(storage.getItem(key("balloon-companion-pilot-profile")), null);
  const queue = outbox(); const resumed = await migrateGuestAndLegacyToUser({ userId: "user-1", deviceId: "device-1", storage, outbox: queue });
  assert.equal(resumed.state, "COMPLETE"); assert.ok(storage.getItem(GUEST_TO_USER_MIGRATION_KEY));
  const before = storage.snapshot(); const repeated = await migrateGuestAndLegacyToUser({ userId: "user-1", deviceId: "device-1", storage, outbox: queue });
  assert.equal(repeated.imported, 0); assert.deepEqual(storage.snapshot(), before);
});

test("RecordedFlight absent est sélectionné avec tous ses points, un ID USER existant n'est jamais écrasé", () => {
  const user = { id: "f1", points: [{ latitude: 50, longitude: 2 }] };
  const guestNew = { id: "f2", points: Array.from({ length: 3323 }, (_, index) => ({ timestamp: index })) };
  const guestConflict = { id: "f1", points: [{ latitude: 99 }] };
  const plan = selectAbsentMigrationRecords([user], [guestNew, guestConflict]);
  assert.equal(plan.additions[0].points.length, 3323); assert.deepEqual(plan.conflicts, ["f1"]); assert.deepEqual(user.points, [{ latitude: 50, longitude: 2 }]);
});

test("le login attend la migration avant les enfants et le runtime refuse collision ou échec", async () => {
  const [auth, runtime, migration] = await Promise.all([
    readFile(new URL("../../contexts/AuthContext.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8"),
    readFile(new URL("./guestToUserMigration.ts", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /userWaitingForMigration[\s\S]*runtimeChildren/);
  assert.match(runtime, /localDataMigrationState !== "MIGRATION_COMPLETE"[\s\S]*localDataMigrationCollisions\.length > 0/);
  assert.doesNotMatch(migration, /removeItem|deleteDatabase|\.clear\(|supabase|fetch\s*\(|\.rpc\s*\(/i);
});
