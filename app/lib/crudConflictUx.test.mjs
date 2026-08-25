import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const runtimePath = new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url);
const pagePath = new URL("../more/cloud-sync/page.tsx", import.meta.url);

test("l'UX expose les cinq états et les deux choix sans identifiants techniques", async () => {
  const source = await readFile(pagePath, "utf8");
  for (const label of ["Synchronisé", "Synchronisation en cours", "Hors ligne", "Erreur de synchronisation", "Conflit à résoudre", "Garder ma version", "Utiliser la version Cloud"]) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, />mutationId</);
  assert.doesNotMatch(source, />revision</);
  assert.match(source, /retryCloudSyncThroughRuntimeController/);
  assert.doesNotMatch(source, /syncPendingMutations|syncMutationById|apply_cloud_sync_mutation/);
});

test("les helpers CRUD restent DEV targeted et réutilisent les primitives production", async () => {
  const source = await readFile(runtimePath, "utf8");
  assert.match(source, /const controlledApi = controlled \?/);
  assert.match(source, /resolveCrudConflictLocalWins:/);
  assert.match(source, /resolveCrudConflictServerWins:/);
  assert.match(source, /createBrowserCrudConflictResolver/);
});
