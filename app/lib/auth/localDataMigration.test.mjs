import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrateApprovedLegacyData } from "./localDataMigration.ts";

const legacy = [
  { collection: "flights", id: "flight-1", value: { id: "flight-1", points: [1, 2] } },
  { collection: "journal", id: "journal-1", value: { id: "journal-1", title: "Vol" } },
  { collection: "balloons", id: "balloon-1", value: { id: "balloon-1", registration: "F-TEST" } },
  { collection: "documents", id: "document-1", value: { metadata: { id: "document-1" }, file: new Blob(["pdf"], { type: "application/pdf" }) } },
  { collection: "preferences", id: "pilot-profile", value: "profile" },
];

function memoryRepository(source = legacy, initial = []) {
  const scoped = new Map(initial.map((record) => [`USER:user-1:${record.collection}:${record.id}`, structuredClone(record)]));
  const markers = [];
  let writes = 0;
  return {
    repository: {
      listLegacy: async () => structuredClone(source),
      getScoped: async (scope, collection, id) => structuredClone(scoped.get(`${scope}:${collection}:${id}`) ?? null),
      putScoped: async (scope, record) => { writes += 1; scoped.set(`${scope}:${record.collection}:${record.id}`, structuredClone(record)); },
      listScoped: async (scope, collection) => [...scoped.entries()].filter(([key]) => key.startsWith(`${scope}:${collection}:`)).map(([, value]) => structuredClone(value)),
      markComplete: (marker) => markers.push(marker),
    },
    scoped,
    markers,
    writes: () => writes,
    legacySnapshot: structuredClone(source),
  };
}

test("approve copie toutes les collections vers USER en conservant les IDs puis vérifie", async () => {
  const memory = memoryRepository();
  const states = [];
  const result = await migrateApprovedLegacyData({ userId: "user-1", deviceId: "device-1", repository: memory.repository, now: () => "2026-08-11T12:00:00.000Z", onState: (state) => states.push(state) });
  assert.equal(result, "MIGRATION_COMPLETE");
  assert.deepEqual(states, ["MIGRATION_COPYING", "MIGRATION_VERIFYING", "MIGRATION_COMPLETE"]);
  assert.deepEqual([...memory.scoped.values()].map(({ id }) => id).sort(), legacy.map(({ id }) => id).sort());
  assert.deepEqual(memory.markers, [{ userId: "user-1", deviceId: "device-1", completedAt: "2026-08-11T12:00:00.000Z" }]);
  assert.deepEqual(legacy, memory.legacySnapshot);
});

test("une relance identique est idempotente et ne crée aucun doublon", async () => {
  const memory = memoryRepository();
  await migrateApprovedLegacyData({ userId: "user-1", deviceId: "device-1", repository: memory.repository });
  assert.equal(memory.writes(), legacy.length);
  await migrateApprovedLegacyData({ userId: "user-1", deviceId: "device-1", repository: memory.repository });
  assert.equal(memory.writes(), legacy.length);
  assert.equal(memory.scoped.size, legacy.length);
});

test("un même ID au contenu différent produit CONFLICT sans écrasement", async () => {
  const conflicting = { collection: "flights", id: "flight-1", value: { id: "flight-1", points: [99] } };
  const memory = memoryRepository(legacy, [conflicting]);
  const result = await migrateApprovedLegacyData({ userId: "user-1", deviceId: "device-1", repository: memory.repository });
  assert.deepEqual(result, { state: "MIGRATION_FAILED", collection: "flights", id: "flight-1", reason: "CONFLICT" });
  assert.deepEqual(memory.scoped.get("USER:user-1:flights:flight-1"), conflicting);
  assert.equal(memory.markers.length, 0);
});

test("COMPLETE est impossible si la vérification des IDs échoue", async () => {
  const memory = memoryRepository();
  const repository = { ...memory.repository, listScoped: async () => [] };
  const result = await migrateApprovedLegacyData({ userId: "user-1", deviceId: "device-1", repository });
  assert.deepEqual(result, { state: "MIGRATION_FAILED", collection: "flights", id: "flight-1", reason: "VERIFY_FAILED" });
  assert.equal(memory.markers.length, 0);
});

test("la migration locale exclut session, météo, debug et Supabase", () => {
  const source = readFileSync(new URL("./localDataMigration.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /flight_session|weather_analysis|planned_trajectories|dev-|supabase|fetch\s*\(|removeItem|\.delete\s*\(/i);
  assert.match(source, /"readonly"/);
});
