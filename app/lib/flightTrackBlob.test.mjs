import assert from "node:assert/strict";
import test from "node:test";

import {
  createFlightTrackBlob,
  encodeFlightTrackBlob,
  parseFlightTrackBlob,
  safeFlightTrackObjectKey,
  sha256Hex,
} from "./flightTrackBlob.ts";

function flight(pointCount = 3323) {
  return {
    id: "4aa82864-3c96-44e9-abf1-3d8c96943239",
    schemaVersion: 1,
    status: "COMPLETED",
    startedAt: 1_777_000_000_000,
    endedAt: 1_777_018_060_000,
    points: Array.from({ length: pointCount }, (_, index) => ({
      timestamp: 1_777_000_000_000 + index * 5_000,
      latitude: 50.8 + index / 1_000_000,
      longitude: 2.69 + index / 1_000_000,
      altitudeMeters: 50 + index / 10,
      speedMetersPerSecond: 4.2,
      headingDegrees: 90,
      horizontalAccuracyMeters: 5,
      verticalAccuracyMeters: 8,
      quality: "VALID",
      segmentId: "segment-1",
    })),
    summary: { durationSeconds: 18060, distanceMeters: 13300, minAltitudeMeters: 50, maxAltitudeMeters: 1025, averageGroundSpeedMetersPerSecond: 3, maxGroundSpeedMetersPerSecond: 7.9 },
    createdAt: 1_777_000_000_000,
    updatedAt: 1_777_018_060_000,
  };
}

test("un vol de 3323 points produit un blob versionné complet et raisonnable", async () => {
  const source = flight();
  const blob = createFlightTrackBlob(source);
  const bytes = encodeFlightTrackBlob(blob);
  const parsed = parseFlightTrackBlob(bytes, source.id);
  assert.equal(parsed.points.length, 3323);
  assert.deepEqual(parsed.points, source.points);
  assert.ok(bytes.byteLength > 100_000 && bytes.byteLength < 5_000_000);
  assert.match(await sha256Hex(bytes), /^[a-f0-9]{64}$/);
});

test("checksum change dès qu'un point change", async () => {
  const first = encodeFlightTrackBlob(createFlightTrackBlob(flight(2)));
  const changed = flight(2);
  changed.points[1].altitudeMeters += 1;
  const second = encodeFlightTrackBlob(createFlightTrackBlob(changed));
  assert.notEqual(await sha256Hex(first), await sha256Hex(second));
});

test("refuse mauvais flightId, schéma, coordonnées et path traversal", () => {
  const bytes = encodeFlightTrackBlob(createFlightTrackBlob(flight(2)));
  assert.throws(() => parseFlightTrackBlob(bytes, "other"), /TRACK_FLIGHT_ID_MISMATCH/);
  const unknown = JSON.parse(new TextDecoder().decode(bytes)); unknown.schemaVersion = 2;
  assert.throws(() => parseFlightTrackBlob(new TextEncoder().encode(JSON.stringify(unknown)), flight(2).id), /UNSUPPORTED_TRACK_SCHEMA/);
  const invalid = flight(2); invalid.points[0].latitude = 100;
  assert.throws(() => createFlightTrackBlob(invalid), /INVALID_LOCAL_FLIGHT_TRACK/);
  assert.throws(() => safeFlightTrackObjectKey("user", "../flight", 1), /INVALID_TRACK_OBJECT_IDENTITY/);
});

test("wiring: import silencieux sans enqueue et upload séparé des mutations flight", async () => {
  const fs = await import("node:fs/promises");
  const storage = await fs.readFile(new URL("./recordedFlightStorage.ts", import.meta.url), "utf8");
  const browser = await fs.readFile(new URL("./flightTrackCloudBrowser.ts", import.meta.url), "utf8");
  assert.doesNotMatch(storage.match(/hydrateTrackFromCloudWithoutEnqueue[\s\S]*?\n  \}/)?.[0] ?? "", /enqueueLocalSyncMutation/);
  assert.match(browser, /r2Provider\.upload/);
  assert.match(browser, /storage_provider: "R2"/);
  assert.doesNotMatch(browser, /enqueueLocalSyncMutation|logbook-entry/);
});

test("migration prépare un bucket privé et des policies ownership par premier dossier", async () => {
  const sql = await (await import("node:fs/promises")).readFile(new URL("../../supabase/migrations/20260826120000_cloud_sync_flight_tracks.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists track_generation/);
  assert.match(sql, /create index if not exists flights_track_cleanup_idx/);
  assert.match(sql, /'flight-tracks', 'flight-tracks', false, 52428800/);
  assert.match(sql, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g);
  assert.match(sql, /for select to authenticated/);
  assert.match(sql, /for insert to authenticated/);
  assert.match(sql, /for update to authenticated/);
  assert.match(sql, /for delete to authenticated/);
});
