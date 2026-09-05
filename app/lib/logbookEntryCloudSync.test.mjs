import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BrowserCloudSyncPayloadProvider } from "./cloudSyncBrowser.ts";
import { officialAscensionCloudMutations } from "./flightCompletionStorage.ts";
import { scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "./flightCompletionStorage.ts";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const scope = `USER:${USER_ID}`;

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key) { return this.values.get(key) ?? null; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  removeItem(key) { this.values.delete(key); }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const ascension = {
  id: "ascension-a", sourceFlightId: "flight-a", source: "GPS_BALLOON_COMPANION",
  dateIso: "2026-08-23", date: "23 août 2026", balloonModel: "Z105", balloonManufacturer: "Cameron",
  registration: "F-TEST", departure: "Boeschepe", arrival: "Lille", category: "Libre à air chaud",
  pilotFunction: "Pilote", regulatoryRole: "PIC", supervisedByFiB: true, nightFlight: false, maximumAltitudeM: 850, gpsDurationMinutes: 60,
  officialDurationMinutes: 55, flightNature: "TRAINING_BPL", takeoffCount: 2, landingCount: 2,
  instructor: { name: "Alice", licenceNumber: "FI-1" }, observations: "RAS",
};

test("OfficialAscension produit un payload logbook_entry complet sans date localisée", async () => {
  const storage = new MemoryStorage();
  storage.setItem(scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY), JSON.stringify({ officialAscensions: [ascension] }));
  const payload = await new BrowserCloudSyncPayloadProvider(storage, scope).build({
    mutationId: "mutation-a", entityType: "logbook-entry", entityId: ascension.id,
    operation: "UPSERT", baseRevision: 0, createdAt: "2026-08-23T10:00:00.000Z", attempts: 0,
  });
  assert.equal(payload.serverEntityType, "logbook_entry");
  assert.equal(payload.payload.flight_id, "flight-a");
  assert.equal(payload.payload.flight_nature, "TRAINING_BPL");
  assert.equal(payload.payload.takeoff_count, 2);
  assert.deepEqual(payload.payload.instructor, ascension.instructor);
  assert.equal(payload.payload.regulatory_role, "PIC");
  assert.equal(payload.payload.supervised_by_fi_b, true);
  assert.equal("date" in payload.payload, false);
  assert.equal(payload.payload.date_iso, "2026-08-23");
});

test("le payload conserve tous les rôles et les valeurs réglementaires null/false", async () => {
  for (const [regulatoryRole, supervisedByFiB] of [["DUAL", false], ["FI_B", false], ["FE_B", false], [null, null]]) {
    const storage = new MemoryStorage();
    const value = { ...ascension, id: `entry-${regulatoryRole ?? "legacy"}`, regulatoryRole, supervisedByFiB };
    storage.setItem(scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY), JSON.stringify({ officialAscensions: [value] }));
    const result = await new BrowserCloudSyncPayloadProvider(storage, scope).build({ mutationId: `mutation-${regulatoryRole ?? "legacy"}`, entityType: "logbook-entry", entityId: value.id, operation: "UPSERT", baseRevision: 0, createdAt: "2026-08-23T10:00:00.000Z", attempts: 0 });
    assert.equal(result.payload.regulatory_role, regulatoryRole);
    assert.equal(result.payload.supervised_by_fi_b, supervisedByFiB);
  }
});

test("le payload logbook_entry conserve la nature CAPTIVE", async () => {
  const storage = new MemoryStorage();
  const captive = { ...ascension, id: "ascension-captive", sourceFlightId: null, source: "MANUAL", gpsDurationMinutes: null, flightNature: "CAPTIVE", instructor: undefined };
  storage.setItem(scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY), JSON.stringify({ officialAscensions: [captive] }));
  const payload = await new BrowserCloudSyncPayloadProvider(storage, scope).build({ mutationId: "mutation-captive", entityType: "logbook-entry", entityId: captive.id, operation: "UPSERT", baseRevision: 0, createdAt: "2026-09-04T10:00:00.000Z", attempts: 0 });
  assert.equal(payload.payload.flight_nature, "CAPTIVE");
});

test("le diff OfficialAscension produit UPSERT et DELETE par identifiant", () => {
  assert.deepEqual(officialAscensionCloudMutations([], [ascension]), [{ entityId: "ascension-a", operation: "UPSERT" }]);
  assert.deepEqual(officialAscensionCloudMutations([ascension], [{ ...ascension, observations: "Vent faible" }]), [{ entityId: "ascension-a", operation: "UPSERT" }]);
  assert.deepEqual(officialAscensionCloudMutations([ascension], []), [{ entityId: "ascension-a", operation: "DELETE" }]);
});

test("logbook-entry est autorisé dans le drain global et en ciblé", () => {
  const service = readFileSync(new URL("./cloudSyncService.ts", import.meta.url), "utf8");
  const automatic = service.match(/AUTOMATIC_SYNC_ENTITY_TYPES = Object\.freeze\(\[\.\.\.PHASE_3A_SYNC_ENTITY_TYPES,([^\]]+)/)?.[1] ?? "";
  const targeted = service.match(/PHASE_3B_TARGETED_SYNC_ENTITY_TYPES = ([^;]+)/)?.[1] ?? "";
  assert.match(automatic, /logbook-entry/);
  assert.equal(targeted, "AUTOMATIC_SYNC_ENTITY_TYPES");
});

test("la migration ajoute le schéma et le protocole logbook_entry sans être appliquée", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260823120000_cloud_sync_logbook_entries.sql", import.meta.url), "utf8");
  for (const field of ["flight_nature", "takeoff_count", "landing_count", "instructor", "examiner"]) assert.match(migration, new RegExp(field));
  assert.match(migration, /logbook_entries_user_date_idx/);
  assert.match(migration, /where flight_id is not null and deleted_at is null/);
  for (const status of ["ALREADY_APPLIED", "CONFLICT", "NOT_FOUND", "APPLIED"]) assert.match(migration, new RegExp(status));
  assert.match(migration, /set deleted_at = statement_timestamp\(\)/);
});

test("la migration captive étend uniquement la contrainte flight_nature", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260904120000_add_captive_logbook_flight_nature.sql", import.meta.url), "utf8");
  assert.match(migration, /drop constraint if exists logbook_entries_flight_nature_check/);
  assert.match(migration, /add constraint logbook_entries_flight_nature_check/);
  assert.match(migration, /'CAPTIVE'/);
});

test("la migration réglementaire est additive, sans backfill, et préserve les champs absents en UPDATE", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260905120000_add_logbook_regulatory_role.sql", import.meta.url), "utf8");
  assert.match(migration, /add column if not exists regulatory_role text null/);
  assert.match(migration, /add column if not exists supervised_by_fi_b boolean null/);
  for (const role of ["PIC", "DUAL", "FI_B", "FE_B"]) assert.match(migration, new RegExp(`'${role}'`));
  assert.doesNotMatch(migration, /update public\.logbook_entries\s+set regulatory_role/i);
  assert.match(migration, /p_payload \? 'regulatory_role'[\s\S]*else t\.regulatory_role end/);
  assert.match(migration, /p_payload \? 'supervised_by_fi_b'[\s\S]*else t\.supervised_by_fi_b end/);
});
