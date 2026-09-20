import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../contexts/AuthContext.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("./useCloudSyncVerdict.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../more/cloud-sync/page.tsx", import.meta.url), "utf8");

test("online, pageshow, focus, visible et Réessayer rejoignent l'unique passage complet", () => {
  for (const event of ["online", "pageshow", "focus"]) assert.match(runtime, new RegExp(`addEventListener\\(\\"${event}`));
  assert.match(runtime, /addEventListener\(CLOUD_SYNC_REPAIR_REQUESTED_EVENT/);
  assert.match(runtime, /document\.addEventListener\("visibilitychange", visibility\)/);
  assert.match(runtime, /if \(manualCloudSyncOperation\) return manualCloudSyncOperation/);
  assert.match(runtime, /requestCompleteCloudSyncRepair/);
  assert.match(runtime, /automaticCloudSyncController\.synchronizeNow\(\)/);
});

test("OFFLINE_SESSION est revalidée sans boucle et sans effacer la session sur erreur", () => {
  assert.match(auth, /current\.state !== "OFFLINE_SESSION"/);
  assert.match(auth, /authRevalidationRef\.current/);
  for (const event of ["online", "pageshow", "focus"]) assert.match(auth, new RegExp(`addEventListener\\(\\"${event}`));
  assert.match(auth, /addEventListener\(CLOUD_SYNC_REPAIR_REQUESTED_EVENT/);
  assert.match(auth, /document\.addEventListener\("visibilitychange", visible\)/);
  assert.doesNotMatch(auth, /setInterval/);
});

test("l'inspection conserve le dernier diagnostic et utilise document.visibilitychange", () => {
  assert.doesNotMatch(hook, /setVerdict\(unknown\(scope\)\)/);
  assert.match(hook, /\{ \.\.\.current, checking: true \}/);
  assert.match(hook, /document\.addEventListener\("visibilitychange", visible\)/);
  assert.match(hook, /stabilityRetries < 2/);
  assert.match(page, /Dernier état connu/);
  assert.match(page, /Vérification en cours/);
});

test("la reconstruction des traces couvre upload, download et file vide", () => {
  assert.match(runtime, /discoverPendingJobs\(queue\)/);
  assert.match(runtime, /discoverMissingDownloadJobs\(queue\)/);
  assert.match(runtime, /downloadsChecked: result\.discoveryComplete && downloadsChecked/);
  assert.match(runtime, /generation: cloudSyncVerdictGeneration\(\)/);
});
