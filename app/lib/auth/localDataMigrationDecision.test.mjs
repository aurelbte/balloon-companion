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

test("une décision liée au manifest pilote la reprise sans attribution automatique", () => {
  const migration = readFileSync(new URL("./guestToUserMigration.ts", import.meta.url), "utf8");
  const context = readFileSync(new URL("../../contexts/AuthContext.tsx", import.meta.url), "utf8");
  assert.match(migration, /getLocalDataMigrationDecision\(input\.storage, input\.userId, input\.deviceId, manifest\.id\)/);
  assert.match(migration, /decision\?\.decision !== "MIGRATION_APPROVED"[\s\S]*REVIEW_REQUIRED/);
  assert.match(context, /saveLocalDataMigrationDecision\(window\.localStorage, \{ \.\.\.review, decision \}\)/);
});

test("aucune requête Supabase métier ni opération destructive n'est ajoutée", () => {
  const decision = readFileSync(new URL("./localDataMigrationDecision.ts", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../../components/auth/LocalDataMigrationDialog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(`${decision}\n${dialog}`, /supabase|fetch\s*\(|removeItem\s*\(|localStorage\.clear|indexedDB\.deleteDatabase/i);
});

test("les états B6 actionnables utilisent une alerte compacte hors du flux", () => {
  const dialog = readFileSync(new URL("../../components/auth/LocalDataMigrationDialog.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../../components/auth/LocalDataMigrationDialog.module.css", import.meta.url), "utf8");
  const cloud = readFileSync(new URL("../../more/cloud-sync/page.tsx", import.meta.url), "utf8");
  assert.match(dialog, /localDataImportReviewPending[\s\S]*IMPORT_BLOCKED[\s\S]*SOURCE_CHANGED/);
  assert.match(dialog, /Données à vérifier[\s\S]*href="\/more\/cloud-sync"/);
  assert.match(dialog, /pathname !== "\/more\/cloud-sync"/);
  assert.doesNotMatch(dialog, /return auth\.localDataImportNotice \? <p/);
  assert.match(styles, /\.notice \{[\s\S]*position: fixed/);
  assert.match(cloud, /auth\.localDataImportNotice[\s\S]*Données locales sur cet appareil/);
  assert.match(cloud, /Ce sont mes données — les rattacher[\s\S]*Ne pas importer/);
  assert.match(cloud, /decideReviewedLocalDataImport/);
  assert.match(cloud, /Conflits de données locales[\s\S]*DUPLICATE_REGISTRATION/);
  assert.doesNotMatch(dialog, /Données différentes sur cet appareil|collisions\.length > 0\) return <div className=\{styles\.backdrop\}/);
  assert.match(dialog, /const visible = auth\.state === "SIGNED_IN" && migration\?\.state === "PENDING_LOCAL_DATA_MIGRATION"/);
});

test("les états B6 sans action ne créent aucun bloc global", () => {
  const dialog = readFileSync(new URL("../../components/auth/LocalDataMigrationDialog.tsx", import.meta.url), "utf8");
  const actionRequired = dialog.slice(dialog.indexOf("const actionRequired"), dialog.indexOf("useEffect", dialog.indexOf("const actionRequired")));
  assert.doesNotMatch(actionRequired, /DEFERRED|CLAIMED_OTHER/);
});
