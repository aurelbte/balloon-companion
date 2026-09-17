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

test("ancien importeur bloqué sans aucune lecture ou copie métier", async () => {
  const memory = memoryRepository();
  const states = [];
  const repository = new Proxy(memory.repository, { get() { throw new Error("repository must not be accessed"); } });
  const result = await migrateApprovedLegacyData({ userId: "user-1", deviceId: "device-1", repository, onState: state => states.push(state) });
  assert.deepEqual(result, { state: "MIGRATION_FAILED", collection: "preferences", id: "B6_CLAIM_REQUIRED", reason: "VERIFY_FAILED" });
  assert.deepEqual(states, [result]); assert.equal(memory.writes(), 0); assert.equal(memory.markers.length, 0);
});

test("relance ancienne et compte différent restent bloqués, données conservées", async () => {
  const existing = legacy[0], memory = memoryRepository(legacy, [existing]);
  for (const userId of ["user-1", "user-1", "user-2"]) {
    const result = await migrateApprovedLegacyData({ userId, deviceId: "device-1", repository: memory.repository });
    assert.equal(result.id, "B6_CLAIM_REQUIRED");
  }
  assert.equal(memory.writes(), 0); assert.equal(memory.markers.length, 0);
  assert.deepEqual(memory.scoped.get("USER:user-1:flights:flight-1"), existing);
  assert.deepEqual(legacy, memory.legacySnapshot);
});

test("la migration locale exclut session, météo, debug et Supabase", () => {
  const source = readFileSync(new URL("./localDataMigration.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /flight_session|weather_analysis|planned_trajectories|dev-|supabase|fetch\s*\(|removeItem|\.delete\s*\(/i);
  assert.match(source, /"readonly"/);
});
