import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { serviceWorkerRegistrationReadiness } from "./offlineReadiness.ts";
import {
  LOW_STORAGE_MINIMUM_FREE_BYTES,
  inspectStorageEstimate,
  offlineReadinessLabel,
  persistenceStatusLabel,
  requestPersistentStorageOnce,
  resetStorageResilienceForTests,
  storageEstimateWarning,
} from "./storageResilience.ts";

test("persist accordé n'est demandé qu'une fois et n'est jamais présenté comme une garantie", async () => {
  resetStorageResilienceForTests();
  let calls = 0;
  const storage = { persisted: async () => false, persist: async () => { calls += 1; return true; } };
  assert.equal(await requestPersistentStorageOnce(storage), "GRANTED");
  assert.equal(await requestPersistentStorageOnce(storage), "GRANTED");
  assert.equal(calls, 1);
  assert.match(persistenceStatusLabel("GRANTED"), /sans garantie absolue/);

  resetStorageResilienceForTests();
  let unnecessaryRequest = false;
  assert.equal(await requestPersistentStorageOnce({ persisted: async () => true, persist: async () => { unnecessaryRequest = true; return true; } }), "GRANTED");
  assert.equal(unnecessaryRequest, false);
});

test("persist refusé, absent ou rejeté reste non bloquant et explicite", async () => {
  for (const [storage, expected] of [
    [{ persisted: async () => false, persist: async () => false }, "NOT_GRANTED"],
    [undefined, "UNAVAILABLE"],
    [{ persisted: async () => { throw new Error("blocked"); }, persist: async () => true }, "UNVERIFIABLE"],
  ]) {
    resetStorageResilienceForTests();
    assert.equal(await requestPersistentStorageOnce(storage), expected);
    assert.ok(persistenceStatusLabel(expected).length > 0);
  }
});

test("estimate disponible distingue espace sain, faible et besoin documentaire", async () => {
  const healthy = await inspectStorageEstimate({ estimate: async () => ({ usage: 100 * 1024 * 1024, quota: 1024 * 1024 * 1024 }) });
  assert.equal(healthy.state, "AVAILABLE");
  assert.equal(healthy.low, false);
  assert.equal(storageEstimateWarning(healthy), null);

  const low = await inspectStorageEstimate({ estimate: async () => ({ usage: 180 * 1024 * 1024, quota: 200 * 1024 * 1024 }) });
  assert.equal(low.low, true);
  assert.match(storageEstimateWarning(low), /faible/);
  assert.match(storageEstimateWarning({ ...healthy, remaining: 10 }, 20), /faible/);
  assert.equal(LOW_STORAGE_MINIMUM_FREE_BYTES, 50 * 1024 * 1024);
});

test("estimate incomplet, absent ou rejeté ne fabrique aucune capacité rassurante", async () => {
  for (const [storage, expected] of [
    [{ estimate: async () => ({ usage: undefined, quota: 100 }) }, "INCOMPLETE"],
    [undefined, "UNAVAILABLE"],
    [{ estimate: async () => { throw new Error("denied"); } }, "UNVERIFIABLE"],
  ]) {
    const estimate = await inspectStorageEstimate(storage);
    assert.equal(estimate.state, expected);
    assert.match(storageEstimateWarning(estimate), /non vérifiable/);
  }
});

test("estimate refuse usage supérieur au quota mais accepte un quota exactement rempli", async () => {
  const incoherent = await inspectStorageEstimate({ estimate: async () => ({ usage: 101, quota: 100 }) });
  assert.deepEqual(incoherent, { state: "INCOMPLETE", low: false });
  assert.equal(incoherent.remaining, undefined);

  const full = await inspectStorageEstimate({ estimate: async () => ({ usage: 100, quota: 100 }) });
  assert.deepEqual(full, { state: "AVAILABLE", usage: 100, quota: 100, remaining: 0, low: true });

  const normal = await inspectStorageEstimate({ estimate: async () => ({ usage: 25, quota: 100 }) });
  assert.deepEqual(normal, { state: "AVAILABLE", usage: 25, quota: 100, remaining: 75, low: true });
});

test("service worker prêt ou échoué produit un état visible sans promesse permanente", async () => {
  assert.equal(await serviceWorkerRegistrationReadiness({ active: {}, installing: null, waiting: null }), "READY");
  assert.equal(await serviceWorkerRegistrationReadiness({ active: null, installing: null, waiting: null }), "FAILED");
  assert.match(offlineReadinessLabel("READY"), /sans garantie/);
  assert.match(offlineReadinessLabel("FAILED"), /échouée/);

  class Worker extends EventTarget { state = "installing"; }
  const installedWorker = new Worker();
  const installed = serviceWorkerRegistrationReadiness({ active: null, installing: installedWorker, waiting: null });
  installedWorker.state = "installed";
  installedWorker.dispatchEvent(new Event("statechange"));
  assert.equal(await installed, "READY");
  const failedWorker = new Worker();
  const failed = serviceWorkerRegistrationReadiness({ active: null, installing: failedWorker, waiting: null });
  failedWorker.state = "redundant";
  failedWorker.dispatchEvent(new Event("statechange"));
  assert.equal(await failed, "FAILED");
});

test("les contrôles vol et documents restent best-effort avant l'écriture réelle", () => {
  const flight = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const add = readFileSync(new URL("../more/profile/balloons/[id]/documents/new/page.tsx", import.meta.url), "utf8");
  const replace = readFileSync(new URL("../more/profile/balloons/[id]/documents/[documentId]/page.tsx", import.meta.url), "utf8");
  assert.match(flight, /void refreshStorageEstimate\(\);[\s\S]*await startTracking/);
  assert.doesNotMatch(flight, /await refreshStorageEstimate\(\)/);
  assert.match(add, /void refreshStorageEstimate\(\)[\s\S]*addDocument/);
  assert.match(replace, /void refreshStorageEstimate\(\)[\s\S]*replaceDocumentFile/);
  assert.match(add, /reason instanceof Error \? reason\.message/);
  assert.match(replace, /reason instanceof Error \? reason\.message/);
  const documentStorage = readFileSync(new URL("./balloonDocumentStorage.ts", import.meta.url), "utf8");
  assert.match(documentStorage, /error\.name === "QuotaExceededError"/);
  assert.match(documentStorage, /Stockage insuffisant sur cet appareil/);
});

test("la reprise rafraîchit estimate et C4 reste limité aux deux shells", () => {
  const registration = readFileSync(new URL("../components/FlightOfflineRegistration.tsx", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../../scripts/flight-offline-worker.js", import.meta.url), "utf8");
  assert.match(registration, /visibilitychange/);
  assert.match(registration, /pageshow/);
  assert.match(registration, /focus/);
  assert.match(worker, /FLIGHT_OFFLINE\.shell/);
  assert.match(worker, /FLIGHT_OFFLINE\.completionShell/);
  assert.doesNotMatch(worker, /\/journal|\/prepare|\/map|\/briefing/);
  assert.doesNotMatch(worker, /self\.skipWaiting|self\.clients\.claim/);
});
