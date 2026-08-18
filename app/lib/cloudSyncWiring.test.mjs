import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../layout.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("./cloudSyncService.ts", import.meta.url), "utf8");
const browser = readFileSync(new URL("./cloudSyncBrowser.ts", import.meta.url), "utf8");
const launch = readFileSync(new URL("./favoriteLaunchSites.ts", import.meta.url), "utf8");
const weather = readFileSync(new URL("./favoriteWeatherPlaces.ts", import.meta.url), "utf8");

test("le runtime utilise des déclencheurs événementiels sans polling", () => {
  assert.match(layout, /<CloudSyncRuntime \/>/);
  assert.match(runtime, /auth\.state !== "SIGNED_IN"/);
  assert.match(runtime, /addEventListener\("online"/);
  assert.match(runtime, /SYNC_MUTATION_ENQUEUED_EVENT/);
  assert.match(runtime, /setTimeout\(\(\) => runPass\(userId\), delay\)/);
  assert.doesNotMatch(runtime, /setInterval|poll/i);
  assert.match(runtime, /if \(controlled\) return/);
  assert.match(runtime, /__BC_CLOUD_SYNC_CONTROLLED_TEST__/);
});

test("la liste blanche client 3A exclut vols, ballons, carnet et documents", () => {
  const allowedBlock = service.match(/PHASE_3A_SYNC_ENTITY_TYPES = Object\.freeze\(\[([\s\S]*?)\]/)?.[1] ?? "";
  for (const allowed of ["pilot-profile", "unit-preferences", "weather-preferences", "aviation-preferences", "favorite-launch-site", "favorite-weather-place"]) assert.match(allowedBlock, new RegExp(allowed));
  for (const forbidden of ["recorded-flight", "balloon", "flight-completion", "balloon-document"]) assert.doesNotMatch(allowedBlock, new RegExp(forbidden));
});

test("les favoris Prépa et Météo produisent des mutations par ligne distinctes", () => {
  assert.match(launch, /enqueueLocalSyncMutation\("favorite-launch-site", favorite\.id\)/);
  assert.match(launch, /enqueueLocalSyncMutation\("favorite-launch-site", removed\.id, "DELETE"\)/);
  assert.match(weather, /enqueueLocalSyncMutation\("favorite-weather-place", favorite\.id\)/);
  assert.match(weather, /enqueueLocalSyncMutation\("favorite-weather-place", removed\.id, "DELETE"\)/);
  assert.doesNotMatch(`${launch}\n${weather}`, /enqueueLocalSyncMutation\("favorite-(launch|weather)-places"/);
});

test("le scan initial reste une API explicite sans déclenchement automatique", () => {
  assert.match(browser, /export async function scanInitialCloudSyncInventory/);
  assert.match(browser, /Read-only and idempotent/);
  assert.doesNotMatch(runtime, /scanInitialCloudSyncInventory/);
});

test("aucun payload Phase 3A ne contient trace GPS ou métadonnée Blob", () => {
  for (const forbidden of ["storage_provider", "object_key", "checksum", "blob_status", "points:", "trace:"]) {
    assert.doesNotMatch(browser, new RegExp(forbidden, "i"));
  }
});
