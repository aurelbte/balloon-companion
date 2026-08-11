import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getLocalDataMigrationDecision,
  LOCAL_DATA_MIGRATION_DECISIONS_KEY,
  saveLocalDataMigrationDecision,
} from "./localDataMigrationDecision.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    snapshot: () => Object.fromEntries(values),
  };
}

test("approve et defer sont persistés par userId et deviceId", () => {
  const storage = memoryStorage();
  saveLocalDataMigrationDecision(storage, { userId: "user-1", deviceId: "device-1", decision: "MIGRATION_APPROVED", decidedAt: "2026-08-11T10:00:00.000Z" });
  saveLocalDataMigrationDecision(storage, { userId: "user-2", deviceId: "device-1", decision: "MIGRATION_DEFERRED", decidedAt: "2026-08-11T10:01:00.000Z" });

  assert.equal(getLocalDataMigrationDecision(storage, "user-1", "device-1")?.decision, "MIGRATION_APPROVED");
  assert.equal(getLocalDataMigrationDecision(storage, "user-2", "device-1")?.decision, "MIGRATION_DEFERRED");
  assert.equal(getLocalDataMigrationDecision(storage, "user-1", "device-2"), null);
});

test("la décision Auth ne modifie aucune donnée métier", () => {
  const storage = memoryStorage({
    "balloon-companion-flight-completion-v1": "journal-intact",
    "balloon-companion-balloons": "ballons-intacts",
  });
  saveLocalDataMigrationDecision(storage, { userId: "user-1", deviceId: "device-1", decision: "MIGRATION_DEFERRED", decidedAt: "2026-08-11T10:00:00.000Z" });
  const values = storage.snapshot();
  assert.equal(values["balloon-companion-flight-completion-v1"], "journal-intact");
  assert.equal(values["balloon-companion-balloons"], "ballons-intacts");
  assert.ok(values[LOCAL_DATA_MIGRATION_DECISIONS_KEY]);
});

test("la modal dépend strictement de SIGNED_IN et du pending, avec résumé réel", () => {
  const dialog = readFileSync(new URL("../../components/auth/LocalDataMigrationDialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /auth\.state === "SIGNED_IN" && migration\?\.state === "PENDING_LOCAL_DATA_MIGRATION"/);
  assert.match(dialog, /Données trouvées sur cet appareil/);
  for (const field of ["summary.flights", "summary.journalEntries", "summary.balloons", "summary.documents", "summary.otherBusinessStorages"]) assert.match(dialog, new RegExp(field.replace(".", "\\.")));
  assert.match(dialog, /MIGRATION_APPROVED/);
  assert.equal((dialog.match(/MIGRATION_DEFERRED/g) ?? []).length, 2);
});

test("une décision existante empêche de recréer la question", () => {
  const context = readFileSync(new URL("../../contexts/AuthContext.tsx", import.meta.url), "utf8");
  assert.match(context, /getLocalDataMigrationDecision\([\s\S]*setPendingLocalDataMigration\(null\);[\s\S]*return;/);
  assert.match(context, /saveLocalDataMigrationDecision\([\s\S]*setPendingLocalDataMigration\(null\)/);
});

test("aucune requête Supabase métier ni opération destructive n'est ajoutée", () => {
  const decision = readFileSync(new URL("./localDataMigrationDecision.ts", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../../components/auth/LocalDataMigrationDialog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(`${decision}\n${dialog}`, /supabase|fetch\s*\(|removeItem\s*\(|localStorage\.clear|indexedDB\.deleteDatabase/i);
});
