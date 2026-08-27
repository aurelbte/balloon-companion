import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  beginFavoriteWeatherPullDiagnostic,
  inspectFavoriteWeatherPullDiagnostics,
  recordFavoriteWeatherPullPlan,
  recordFavoriteWeatherPullResult,
  recordFavoriteWeatherUiHydration,
} from "./favoriteWeatherPullDiagnostics.ts";

test("le diagnostic conserve le plan initial du replay et l'état UI courant", () => {
  beginFavoriteWeatherPullDiagnostic();
  const cursor = { updatedAt: "2026-08-27T10:00:00.000Z", id: "old" };
  recordFavoriteWeatherPullPlan({ inputCursor: cursor, effectiveCursor: null, localFavoriteCount: 0 });
  recordFavoriteWeatherPullPlan({ inputCursor: cursor, effectiveCursor: cursor, localFavoriteCount: 2 });
  recordFavoriteWeatherPullResult({ state: "COMPLETED", fetched: 2 });
  recordFavoriteWeatherUiHydration({ scope: "USER:user-a", favorites: [{ id: "a", name: "Bondues" }], selectedFavoriteId: "a" });

  const state = inspectFavoriteWeatherPullDiagnostics();
  assert.equal(state.lastPullPlans[0].snapshotReplayExecuted, true);
  assert.equal(state.lastPullPlans[0].snapshotReplayReason, "LOCAL_COLLECTION_EMPTY_CURSOR_RESET");
  assert.equal(state.lastPullPlans.length, 2);
  assert.deepEqual(state.lastPullResult, { state: "COMPLETED", fetched: 2 });
  assert.equal(state.lastUiHydration?.favoriteCount, 1);
});

test("le helper end-to-end targeted est une inspection sans déclencheur de sync", () => {
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(runtime, /inspectFavoriteWeatherPlaceEndToEndState\(\)/);
  assert.match(runtime, /\.select\("id,name"\)/);
  assert.match(runtime, /localStorageKey = scopedBusinessStorageKey/);
  const helper = runtime.match(/async function inspectFavoriteWeatherPlaceEndToEndState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(helper, /outbox\.list\(\)/);
  assert.match(helper, /outbox\.listMetadata\(\)/);
  assert.match(helper, /payloadProvider\.build\(mutation\)/);
  assert.match(helper, /inspectAutomaticMutationEligibility\(mutation\)/);
  assert.match(helper, /apply_cloud_sync_mutation/);
  assert.doesNotMatch(helper, /pullFavoriteWeatherPlaces|syncMutationById|syncPendingMutations|bootstrapCloudDataForCurrentUser|\.rpc\(|\.enqueue\(|\.remove\(|\.setMetadata\(|\.insert\(|\.update\(|\.delete\(|setItem\(|removeItem\(/);
});
