import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { setRuntimeAuthSnapshot } from "./auth/dataScopeRuntime.ts";
import { BrowserFlightTrackCloudService } from "./flightTrackCloudBrowser.ts";

const user = (id = "user-a") => setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id, email: `${id}@example.test`, firstName: "", lastName: "" } });
afterEach(() => setRuntimeAuthSnapshot({ state: "UNKNOWN", user: null }));

function recorded(points = 3) {
  return { id: "flight-a", schemaVersion: 1, status: "COMPLETED", startedAt: 1000, endedAt: 3000,
    points: Array.from({ length: points }, (_, i) => ({ timestamp: 1000 + i * 1000, latitude: 50 + i / 100, longitude: 2 + i / 100, altitudeMeters: 100 + i, speedMetersPerSecond: 3, headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8 })),
    summary: { durationSeconds: 2, distanceMeters: 10, minAltitudeMeters: 100, maxAltitudeMeters: 102, averageGroundSpeedMetersPerSecond: 3, maxGroundSpeedMetersPerSecond: 3 }, createdAt: 1000, updatedAt: 3000 };
}

function fakeCloud(options = {}) {
  const remote = { object_key: null, checksum: null, blob_size: null, blob_status: "LOCAL_ONLY", track_generation: 1, deleted_at: null };
  const objects = new Map();
  let metadataFailures = options.metadataFailures ?? 0;
  let uploadCalls = 0;
  const builder = (mode = "select", patch = null) => {
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain, not: () => chain,
      maybeSingle: async () => ({ data: { ...remote }, error: null }),
      update: (value) => builder("update", value),
      then(resolve) {
        if (mode === "update" && metadataFailures > 0) { metadataFailures -= 1; return Promise.resolve(resolve({ error: { code: "500" } })); }
        if (mode === "update") Object.assign(remote, patch);
        return Promise.resolve(resolve({ data: mode === "select" ? [] : null, error: null }));
      },
    };
    return chain;
  };
  const client = {
    from: () => builder(),
    storage: { from: () => ({
      upload: async (key, blob) => { uploadCalls += 1; if (options.onUpload) options.onUpload(); if (options.uploadError) return { error: { message: options.uploadError } }; objects.set(key, blob); return { error: null }; },
      download: async (key) => objects.has(key) ? { data: objects.get(key), error: null } : { data: null, error: { message: "NOT_FOUND" } },
      remove: async (keys) => { if (options.removeError) return { error: { message: options.removeError } }; keys.forEach((key) => objects.delete(key)); return { error: null }; },
    }) },
  };
  return { client, remote, objects, uploadCalls: () => uploadCalls };
}

function localStorageWith(initial) {
  let value = structuredClone(initial);
  return {
    getFlight: async () => structuredClone(value), listFlights: async () => value ? [structuredClone(value)] : [],
    hydrateTrackFromCloudWithoutEnqueue: async (_scope, _id, points) => { if (!value || value.points.length) return false; value = { ...value, points: structuredClone(points) }; return true; },
    value: () => value,
  };
}

test("transport simulé upload: un blob, SHA-256 et reprise metadata idempotente", async () => {
  user();
  const cloud = fakeCloud({ metadataFailures: 1 });
  const local = localStorageWith(recorded(3323));
  const service = new BrowserFlightTrackCloudService(cloud.client, "USER:user-a", local);
  await assert.rejects(service.upload("flight-a"), /TRACK_METADATA_UPDATE/);
  assert.equal(cloud.uploadCalls(), 1);
  await service.upload("flight-a");
  assert.equal(cloud.uploadCalls(), 2);
  assert.equal(cloud.objects.size, 1);
  assert.equal(cloud.remote.blob_status, "READY");
  assert.match(cloud.remote.checksum, /^[a-f0-9]{64}$/);
});

test("transport simulé download refuse checksum invalide et n'écrase pas le local", async () => {
  user();
  const cloud = fakeCloud();
  const source = localStorageWith(recorded(3));
  const uploader = new BrowserFlightTrackCloudService(cloud.client, "USER:user-a", source);
  await uploader.upload("flight-a");
  cloud.remote.checksum = "0".repeat(64);
  const metadataOnly = recorded(0);
  const target = localStorageWith(metadataOnly);
  const downloader = new BrowserFlightTrackCloudService(cloud.client, "USER:user-a", target);
  await assert.rejects(downloader.download("flight-a"), /TRACK_CHECKSUM_MISMATCH/);
  assert.equal(target.value().points.length, 0);
});

test("transport simulé download importe silencieusement les points complets", async () => {
  user();
  const cloud = fakeCloud();
  await new BrowserFlightTrackCloudService(cloud.client, "USER:user-a", localStorageWith(recorded(3323))).upload("flight-a");
  const target = localStorageWith(recorded(0));
  const state = await new BrowserFlightTrackCloudService(cloud.client, "USER:user-a", target).download("flight-a");
  assert.equal(target.value().points.length, 3323);
  assert.equal(state.localPoints, 3323);
});

test("transport simulé protège USER switch pendant upload et cleanup absent est idempotent", async () => {
  user();
  const cloud = fakeCloud({ onUpload: () => user("user-b") });
  const service = new BrowserFlightTrackCloudService(cloud.client, "USER:user-a", localStorageWith(recorded(2)));
  await assert.rejects(service.upload("flight-a"), /TRACK_USER_SWITCH/);
  user();
  await service.cleanup("flight-a");
});
