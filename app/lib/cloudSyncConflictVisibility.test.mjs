import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { aggregateCrudConflicts } from "./crudConflictResolution.ts";
import { inspectCloudSyncVerdict } from "./cloudSyncVerdict.ts";

const mutation = (extra = {}) => ({ mutationId: "mutation-123456789", entityType: "pilot-profile", entityId: "singleton", operation: "UPSERT", baseRevision: 1, createdAt: "2026-09-20T08:00:00.000Z", attempts: 1, ...extra });
const issue = (extra = {}) => ({ kind: "CONFLICT", entityType: "pilot-profile", entityId: "singleton", mutation: mutation(), serverRevision: 2, serverUpdatedAt: "2026-09-20T08:01:00.000Z", serverDeletedAt: null, recordedAt: "2026-09-20T08:02:00.000Z", ...extra });

test("chaque source CONFLICT de C1 produit au moins un détail agrégé", async () => {
  const cases = [
    { issues: [], mutations: [mutation({ lastErrorCode: "CONFLICT" })] },
    { issues: [], mutations: [mutation({ entityType: "balloon", entityId: "b", lastErrorCode: "DUPLICATE_REGISTRATION" })] },
    { issues: [issue()], mutations: [] },
    { issues: [issue({ kind: "BUSINESS_CONFLICT", businessCode: "DUPLICATE_REGISTRATION", entityType: "balloon", entityId: "b" })], mutations: [] },
  ];
  for (const evidence of cases) {
    const verdict = await inspectCloudSyncVerdict({
      getScope: () => "USER:A", getGeneration: () => 0, online: () => true,
      runtime: () => ({ scope: "USER:A" }),
      read: async () => ({ ...evidence, intents: 0, tracks: [], traceActive: false, traceDiscoveryComplete: true, coverageComplete: true, passGeneration: 0 }),
    });
    assert.equal(verdict.state, "CONFLICT");
    assert.ok(aggregateCrudConflicts(evidence.issues, evidence.mutations).length > 0);
  }
});

test("l'UI explique les orphelins, les erreurs de lecture et réserve les actions sûres", () => {
  const page = readFileSync(new URL("../more/cloud-sync/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Impossible de lire les détails du conflit/);
  assert.match(page, /Conflit local incomplet/);
  assert.match(page, /Diagnostic de conflit sans mutation associée/);
  assert.match(page, /issue\.resolution === "REVISION"/);
  assert.match(page, /issue\.resolution === "DUPLICATE_REGISTRATION"/);
  assert.match(page, /Immatriculation déjà utilisée/);
  assert.match(page, /Modifier le ballon concerné/);
  assert.match(page, /Aucune résolution automatique sûre/);
});

test("une inspection rejetée après ses retries quitte obligatoirement checking", () => {
  const hook = readFileSync(new URL("./useCloudSyncVerdict.ts", import.meta.url), "utf8");
  assert.match(hook, /stabilityRetries < 2/);
  assert.match(hook, /current\.state === "SYNCED" \? "UNVERIFIABLE"/);
  assert.match(hook, /generation: cloudSyncVerdictGeneration\(\)[\s\S]*checking: false/);
});

test("le helper DEV est read-only, abrège les identifiants et n'expose aucun payload", () => {
  const browser = readFileSync(new URL("./crudConflictBrowser.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  const helper = browser.match(/export async function getCloudSyncConflictDebugInfo[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(helper, /readExistingSyncStore/);
  assert.match(helper, /entityId: abbreviated/);
  assert.match(helper, /mutationId: abbreviated/);
  assert.doesNotMatch(helper, /payload|\.enqueue\(|\.remove\(|\.updateMutation\(|\.acknowledge\(/);
  assert.match(runtime, /process\.env\.NODE_ENV === "development"/);
  assert.match(runtime, /window\.getCloudSyncConflictDebugInfo/);
});
