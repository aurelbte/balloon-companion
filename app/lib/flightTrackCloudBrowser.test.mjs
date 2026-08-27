import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { scopedBusinessStorageKey, setRuntimeAuthSnapshot } from "./auth/dataScopeRuntime.ts";
import { BrowserFlightTrackCloudService } from "./flightTrackCloudBrowser.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "./flightCompletionStorage.ts";
import { MemoryFlightTrackQueueStorage } from "./flightTrackQueue.ts";

const user = (id = "user-a") => setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id, email: `${id}@example.test`, firstName: "", lastName: "" } });
afterEach(() => setRuntimeAuthSnapshot({ state: "UNKNOWN", user: null }));

function recorded(points = 3) {
  return { id: "flight-a", schemaVersion: 1, status: "COMPLETED", startedAt: 1000, endedAt: 3000,
    points: Array.from({ length: points }, (_, i) => ({ timestamp: 1000 + i * 1000, latitude: 50 + i / 100, longitude: 2 + i / 100, altitudeMeters: 100 + i, speedMetersPerSecond: 3, headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8 })),
    summary: { durationSeconds: 2, distanceMeters: 10, minAltitudeMeters: 100, maxAltitudeMeters: 102, averageGroundSpeedMetersPerSecond: 3, maxGroundSpeedMetersPerSecond: 3 }, createdAt: 1000, updatedAt: 3000 };
}

function fakeCloud(options = {}) {
  const remote = { object_key: null, checksum: null, blob_size: null, blob_status: "LOCAL_ONLY", track_generation: 1, deleted_at: null, storage_provider: null };
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
  return { client, remote, objects, options, recordUpload: () => { uploadCalls += 1; }, uploadCalls: () => uploadCalls };
}

function fakeProviders(cloud) {
  const provider = (name) => ({
    name,
    upload: async ({ flightId, generation, bytes }) => {
      cloud.recordUpload();
      cloud.options.onUpload?.();
      if (cloud.options.uploadError) throw new Error(cloud.options.uploadError);
      const objectKey = name === "R2" ? `users/user-a/flights/${flightId}/track-v${generation}.json` : `user-a/flights/${flightId}/track-v${generation}.json`;
      cloud.objects.set(objectKey, new Blob([bytes.slice().buffer]));
      return { objectKey };
    },
    download: async ({ objectKey }) => {
      const blob = cloud.objects.get(objectKey);
      if (!blob) throw new Error("NOT_FOUND");
      return new Uint8Array(await blob.arrayBuffer());
    },
    delete: async ({ objectKey }) => {
      if (cloud.options.removeError) throw new Error(cloud.options.removeError);
      cloud.objects.delete(objectKey);
    },
  });
  return { r2: provider("R2"), legacy: provider("SUPABASE_STORAGE") };
}

function service(cloud, local) {
  return new BrowserFlightTrackCloudService(cloud.client, "USER:user-a", local, fakeProviders(cloud));
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
  const trackService = service(cloud, local);
  await assert.rejects(trackService.upload("flight-a"), /TRACK_METADATA_UPDATE/);
  assert.equal(cloud.uploadCalls(), 1);
  await trackService.upload("flight-a");
  assert.equal(cloud.uploadCalls(), 2);
  assert.equal(cloud.objects.size, 1);
  assert.equal(cloud.remote.blob_status, "READY");
  assert.match(cloud.remote.checksum, /^[a-f0-9]{64}$/);
});

test("transport simulé download refuse checksum invalide et n'écrase pas le local", async () => {
  user();
  const cloud = fakeCloud();
  const source = localStorageWith(recorded(3));
  const uploader = service(cloud, source);
  await uploader.upload("flight-a");
  cloud.remote.checksum = "0".repeat(64);
  const metadataOnly = recorded(0);
  const target = localStorageWith(metadataOnly);
  const downloader = service(cloud, target);
  await assert.rejects(downloader.download("flight-a"), /TRACK_CHECKSUM_MISMATCH/);
  assert.equal(target.value().points.length, 0);
});

test("transport simulé download importe silencieusement les points complets", async () => {
  user();
  const cloud = fakeCloud();
  await service(cloud, localStorageWith(recorded(3323))).upload("flight-a");
  const target = localStorageWith(recorded(0));
  const state = await service(cloud, target).download("flight-a");
  assert.equal(target.value().points.length, 3323);
  assert.equal(state.localPoints, 3323);
});

test("download reconstruit le Journal riche sans événement enqueue", async () => {
  user();
  const cloud = fakeCloud();
  const sourceFlight = recorded(4);
  await service(cloud, localStorageWith(sourceFlight)).upload("flight-a");
  const target = localStorageWith(recorded(0));
  const values = new Map(), events = [];
  const browserStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: browserStorage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  const key = scopedBusinessStorageKey("USER:user-a", FLIGHT_COMPLETION_STORAGE_KEY);
  values.set(key, JSON.stringify({ version: 4, openingBalance: { confirmed: false, ascensions: null, officialDurationMinutes: null }, journalFlights: [{ id: "flight-a", sourceFlightId: "flight-a", startedAt: 1000, departure: "A", arrival: "B", date: "date", dateIso: "2026-08-26", balloonRegistration: "F-X", durationMinutes: 1, distanceKm: 1, takeoffTime: "10:00", landingTime: "10:01", maxAltitudeM: 999, maxSpeedKmh: 99, notes: "protected", statistics: { takeoffAltitudeAmslM: null, landingAltitudeAmslM: null, averageAltitudeAmslM: null, averageSpeedKmh: null, minimumInFlightSpeedKmh: null, maximumClimbRateMps: null, maximumDescentRateMps: null, averageHeadingDeg: null, directDistanceKm: 0 }, points: [], logbookStatus: "CARNET_VALIDATED", origin: "REAL_GPS" }], officialAscensions: [] }));
  await service(cloud, target).download("flight-a");
  const journal = JSON.parse(values.get(key)).journalFlights[0];
  assert.equal(journal.notes, "protected");
  assert.equal(journal.statistics.takeoffAltitudeAmslM, 100);
  assert.equal(journal.statistics.landingAltitudeAmslM, 103);
  assert.equal(events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("une trace déjà locale répare un Journal historique dégradé sans re-download", async () => {
  user();
  const local = localStorageWith(recorded(4));
  const values = new Map(), events = [];
  const browserStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  globalThis.window = { localStorage: browserStorage, dispatchEvent: (event) => { events.push(event.type); return true; } };
  const key = scopedBusinessStorageKey("USER:user-a", FLIGHT_COMPLETION_STORAGE_KEY);
  values.set(key, JSON.stringify({ version: 4, openingBalance: { confirmed: false, ascensions: null, officialDurationMinutes: null }, journalFlights: [{ id: "flight-a", sourceFlightId: "flight-a", startedAt: 1000, departure: "A", arrival: "B", date: "date", dateIso: "2026-08-26", balloonRegistration: "F-X", durationMinutes: 1, distanceKm: 1, takeoffTime: "10:00", landingTime: "10:01", maxAltitudeM: 999, maxSpeedKmh: 99, notes: "protected", statistics: { takeoffAltitudeAmslM: null, landingAltitudeAmslM: null, averageAltitudeAmslM: null, averageSpeedKmh: null, minimumInFlightSpeedKmh: null, maximumClimbRateMps: null, maximumDescentRateMps: null, averageHeadingDeg: null, directDistanceKm: 0 }, points: [], logbookStatus: "CARNET_VALIDATED", origin: "REAL_GPS" }], officialAscensions: [] }));
  const cloud = fakeCloud();
  await service(cloud, local).download("flight-a");
  const repaired = JSON.parse(values.get(key)).journalFlights[0];
  assert.equal(repaired.statistics.takeoffAltitudeAmslM, 100);
  assert.equal(repaired.statistics.landingAltitudeAmslM, 103);
  assert.equal(repaired.notes, "protected");
  assert.equal(events.includes("balloon-companion:sync-mutation-enqueued"), false);
  delete globalThis.window;
});

test("transport simulé protège USER switch pendant upload et cleanup absent est idempotent", async () => {
  user();
  const cloud = fakeCloud({ onUpload: () => user("user-b") });
  const trackService = service(cloud, localStorageWith(recorded(2)));
  await assert.rejects(trackService.upload("flight-a"), /TRACK_USER_SWITCH/);
  user();
  await trackService.cleanup("flight-a");
});

test("transition: une ancienne trace Supabase reste lisible et un nouvel upload utilise R2", async () => {
  user();
  const cloud = fakeCloud();
  const legacyKey = "user-a/flights/flight-a/track-v1.json";
  const source = recorded(3);
  const { createFlightTrackBlob, encodeFlightTrackBlob, sha256Hex } = await import("./flightTrackBlob.ts");
  const bytes = encodeFlightTrackBlob(createFlightTrackBlob(source));
  cloud.objects.set(legacyKey, new Blob([bytes.slice().buffer]));
  Object.assign(cloud.remote, { object_key: legacyKey, checksum: await sha256Hex(bytes), blob_size: bytes.byteLength, blob_status: "READY", storage_provider: "SUPABASE_STORAGE" });
  const target = localStorageWith(recorded(0));
  await service(cloud, target).download("flight-a");
  assert.equal(target.value().points.length, 3);

  Object.assign(cloud.remote, { object_key: null, checksum: null, blob_size: null, blob_status: "LOCAL_ONLY", storage_provider: null });
  await service(cloud, localStorageWith(source)).upload("flight-a");
  assert.equal(cloud.remote.storage_provider, "R2");
  assert.match(cloud.remote.object_key, /^users\/user-a\/flights\//);
});

test("upload R2 ciblé remplace seulement les métadonnées transport et conserve l'ancien blob Supabase", async () => {
  user();
  const cloud = fakeCloud();
  const legacyKey = "user-a/flights/flight-a/track-v1.json";
  cloud.objects.set(legacyKey, new Blob(["legacy"]));
  Object.assign(cloud.remote, { object_key: legacyKey, checksum: "b".repeat(64), blob_size: 6, blob_status: "READY", storage_provider: "SUPABASE_STORAGE" });
  const state = await service(cloud, localStorageWith(recorded(3))).uploadToR2Targeted("flight-a");
  assert.equal(state.provider, "R2");
  assert.equal(cloud.objects.has(legacyKey), true);
  assert.equal(cloud.objects.size, 2);
  assert.equal(cloud.remote.track_generation, 1);
  assert.equal(cloud.remote.storage_provider, "R2");
});

test("restore R2 ciblé refuse le legacy puis importe sans doublon via le chemin normal", async () => {
  user();
  const cloud = fakeCloud();
  const source = localStorageWith(recorded(4));
  await service(cloud, source).upload("flight-a");
  const target = localStorageWith(recorded(0));
  const restored = await service(cloud, target).restoreFromR2Targeted("flight-a");
  assert.equal(restored.provider, "R2");
  assert.equal(target.value().points.length, 4);
  await service(cloud, target).restoreFromR2Targeted("flight-a");
  assert.equal(target.value().points.length, 4);
  cloud.remote.storage_provider = "SUPABASE_STORAGE";
  await assert.rejects(service(cloud, localStorageWith(recorded(0))).restoreFromR2Targeted("flight-a"), /R2_PROVIDER_REQUIRED/);
});

test("sync manuelle découvre une trace R2 manquante puis la restaure sans job upload", async () => {
  user();
  const cloud = fakeCloud();
  await service(cloud, localStorageWith(recorded(4))).upload("flight-a");
  const target = localStorageWith(recorded(0));
  const tracks = service(cloud, target);
  const queue = new MemoryFlightTrackQueueStorage();
  assert.equal(await tracks.discoverMissingDownloadJobs(queue), 1);
  assert.deepEqual((await queue.list()).map(({ operation }) => operation), ["DOWNLOAD"]);
  await tracks.download("flight-a");
  assert.equal(target.value().points.length, 4);
});
