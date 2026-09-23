import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { setRuntimeAuthSnapshot, guestBusinessStorageKey, scopedBusinessStorageKey } from "./dataScopeRuntime.ts";
import { GUEST_TO_USER_MIGRATION_KEY, migrateGuestAndLegacyToUser as protectedMigration, selectAbsentMigrationRecords } from "./guestToUserMigration.ts";

import { inspectGuestSources, makeGuestManifest } from "./guestImportManifest.ts";
import { acquireGuestImportClaim } from "./guestImportClaim.ts";
import { memoryFactory } from "./guestImportTestHarness.mjs";
const factories = new WeakMap();
function migrateGuestAndLegacyToUser(input) {
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: input.userId } });
  if (!factories.has(input.storage)) factories.set(input.storage, memoryFactory());
  return protectedMigration({ ...input, factory: factories.get(input.storage) });
}

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
  assert.deepEqual(queue.mutations.map(({ entityType, entityId }) => [entityType, entityId]), [["pilot-profile", "singleton"], ["weather-preferences", "singleton"], ["balloon", "b1"], ["flight", "f1"], ["logbook-entry", "a1"]]);
});

test("merge additif protège IDs USER, sourceFlightId dupliqué et collisions", async () => {
  const storage = memoryStorage({
    [key("balloon-companion-balloons")]: JSON.stringify({ balloons: [{ id: "user-balloon", registration: "F-U" }] }),
    [guest("balloon-companion-balloons")]: JSON.stringify({ balloons: [{ id: "guest-balloon", registration: "F-G" }] }),
    [key("balloon-companion-flight-completion-v1")]: JSON.stringify({ openingBalance: { confirmed: true, ascensions: 1, officialDurationMinutes: 10 }, journalFlights: [{ id: "user-j", sourceFlightId: "same", departure: "USER" }], officialAscensions: [] }),
    [guest("balloon-companion-flight-completion-v1")]: JSON.stringify({ openingBalance: { confirmed: true, ascensions: 2, officialDurationMinutes: 20 }, journalFlights: [{ id: "guest-j", sourceFlightId: "same", departure: "GUEST" }, { id: "new", sourceFlightId: "new" }], officialAscensions: [] }),
  });
  const factory = memoryFactory(); factories.set(storage, factory);
  await acquireGuestImportClaim(factory, await makeGuestManifest((await inspectGuestSources(storage, factory, () => {})).entries), "user-1", "device-1", () => {});
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

test("C11 collision account preserves claim/snapshot and resumes after correction", async () => {
  const base="balloon-companion-balloons";
  const source=JSON.stringify({balloons:[{id:"incoming",registration:" f-abcd "}]});
  const storage=memoryStorage({[key(base)]:JSON.stringify({balloons:[{id:"existing",registration:"F-ABCD"}]}),[guest(base)]:source,[guest("balloon-companion-weather-preferences-v1")]:JSON.stringify({weatherModel:"gfs"})});
  const queue=outbox();const result=await migrateGuestAndLegacyToUser({userId:"user-1",deviceId:"device-1",storage,outbox:queue});
  assert.equal(result.state,"REVIEW_REQUIRED");assert.equal(result.collisions[0].reason,"DUPLICATE_REGISTRATION");
  assert.deepEqual(JSON.parse(storage.getItem(key(base))).balloons.map(x=>x.id),["existing"]);
  assert.equal(queue.mutations.some(x=>x.entityType==="balloon"),false);
  assert.ok(storage.getItem(key("balloon-companion-weather-preferences-v1")));
  assert.equal(storage.getItem(guest(base)),source);
  const history=JSON.parse(storage.getItem(GUEST_TO_USER_MIGRATION_KEY));const marker=Object.values(history)[0];assert.equal(marker.completedAt,undefined);assert.equal(marker.completedDomains.includes(base),false);
  const {readGuestImportClaims}=await import('./guestImportClaim.ts');const claims=await readGuestImportClaims(factories.get(storage),()=>{});assert.equal(claims[0].userId,"user-1");
  storage.setItem(key(base),JSON.stringify({balloons:[{id:"existing",registration:"F-EFGH"}]}));
  const retry=await migrateGuestAndLegacyToUser({userId:"user-1",deviceId:"device-1",storage,outbox:queue});assert.equal(retry.state,"COMPLETE");assert.equal(retry.manifestId,result.manifestId);
  assert.deepEqual(JSON.parse(storage.getItem(key(base))).balloons.map(x=>x.id),["existing","incoming"]);
});
test("C11 duplicate guest IDs by registration are all preserved for review, not arbitrarily chosen",async()=>{
 const base="balloon-companion-balloons";const source=JSON.stringify({balloons:[{id:"one",registration:"F-ABCD"},{id:"two",registration:" f-abcd "},{id:"independent",registration:"F-EFGH"}]});
 const storage=memoryStorage({[guest(base)]:source}),queue=outbox();
 for(let i=0;i<2;i++){
 const result=await migrateGuestAndLegacyToUser({userId:"user-1",deviceId:"device-1",storage,outbox:queue});
 assert.equal(result.state,"REVIEW_REQUIRED");assert.equal(result.collisions.filter(x=>x.reason==="DUPLICATE_REGISTRATION").length,2);
 assert.deepEqual(JSON.parse(storage.getItem(key(base))).balloons.map(x=>x.id),["independent"]);
 }
 assert.deepEqual(queue.mutations.filter(x=>x.entityType==="balloon").map(x=>x.entityId),["independent"]);assert.equal(storage.getItem(guest(base)),source);
});
