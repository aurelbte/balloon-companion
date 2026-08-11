import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createPendingLocalDataMigration,
  getCurrentDataScope,
  hasLegacyLocalData,
  summarizeLegacyLocalData,
} from "./dataScope.ts";

const user = { id: "123e4567", email: "pilot@example.com", firstName: "Ada", lastName: "Lovelace" };

function readOnlyStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: () => { throw new Error("écriture interdite"); },
    removeItem: () => { throw new Error("suppression interdite"); },
    snapshot: () => Object.fromEntries(values),
  };
}

test("SIGNED_OUT utilise le scope GUEST", () => {
  assert.equal(getCurrentDataScope({ state: "SIGNED_OUT", user: null }), "GUEST");
});

test("SIGNED_IN et OFFLINE_SESSION utilisent USER avec user.id", () => {
  assert.equal(getCurrentDataScope({ state: "SIGNED_IN", user }), "USER:123e4567");
  assert.equal(getCurrentDataScope({ state: "OFFLINE_SESSION", user }), "USER:123e4567");
  assert.doesNotMatch(getCurrentDataScope({ state: "SIGNED_IN", user }), /pilot@example/);
});

test("les données legacy sont détectées et résumées sans écriture", async () => {
  const storage = readOnlyStorage({
    "balloon-companion-flight-completion-v1": JSON.stringify({ journalFlights: [{ id: "j1" }, { id: "j2" }] }),
    "balloon-companion-balloons": JSON.stringify({ balloons: [{ id: "b1" }] }),
    "balloon-companion-pilot-profile": "{}",
    "balloon_companion_weather_analysis_v1": "{}",
  });
  const before = storage.snapshot();
  const summary = await summarizeLegacyLocalData({
    storage,
    countFlights: async () => 3,
    countDocuments: async () => 4,
  });
  assert.deepEqual(summary, { flights: 3, journalEntries: 2, balloons: 1, documents: 4, otherBusinessStorages: 1 });
  assert.equal(hasLegacyLocalData(summary), true);
  assert.deepEqual(storage.snapshot(), before);
});

test("SIGNED_IN crée uniquement un état PENDING_LOCAL_DATA_MIGRATION si nécessaire", () => {
  const legacyDataSummary = { flights: 1, journalEntries: 0, balloons: 0, documents: 0, otherBusinessStorages: 0 };
  assert.deepEqual(createPendingLocalDataMigration({ snapshot: { state: "SIGNED_IN", user }, deviceId: "device-1", legacyDataSummary }), {
    state: "PENDING_LOCAL_DATA_MIGRATION",
    userId: "123e4567",
    deviceId: "device-1",
    legacyDataSummary,
  });
  assert.equal(createPendingLocalDataMigration({ snapshot: { state: "SIGNED_OUT", user: null }, deviceId: "device-1", legacyDataSummary }), null);
});

test("l'abstraction ne migre, ne supprime et ne synchronise aucune donnée", () => {
  const source = readFileSync(new URL("./dataScope.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setItem\s*\(|removeItem\s*\(|\.delete\s*\(|clear\s*\(|supabase|fetch\s*\(/i);
  assert.match(source, /transaction\(storeName, "readonly"\)/);
});
