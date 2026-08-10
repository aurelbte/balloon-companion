import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRecordedFlight, finalizeRecordedFlight } from "./recordedFlight.ts";
import { BCFLIGHT_FORMAT, createBcFlightBlob, createBcFlightExport, createBcFlightFile, exportBcFlight } from "./bcFlightExport.ts";

function existingFlight({ legacy = false } = {}) {
  const point = {
    timestamp: 1_700_000_000_000,
    latitude: 50.63,
    longitude: 3.06,
    altitudeMeters: 120,
    speedMetersPerSecond: 4,
    headingDegrees: 90,
    horizontalAccuracyMeters: 5,
    verticalAccuracyMeters: 8,
    ...(legacy ? {} : {
      quality: "VALID",
      qualityReason: "NONE",
      appState: "FOREGROUND",
      lastPointTimestamp: 1_700_000_000_000,
      resumedAfterBackground: false,
      firstFixAfterResume: false,
    }),
  };
  return finalizeRecordedFlight(createRecordedFlight({
    id: "flight-export",
    startedAt: point.timestamp,
    firstPoint: point,
    balloonRegistration: "F-ABCD",
  }), point.timestamp + 60_000);
}

test("exporte un vol existant en JSON versionné et ouvrable", async () => {
  const flight = existingFlight();
  const file = createBcFlightFile(flight, new Date("2026-08-10T10:00:00Z"));
  assert.match(file.name, /Balloon Companion\.bcflight$/);
  const parsed = JSON.parse(await file.text());
  assert.equal(parsed.format, BCFLIGHT_FORMAT);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.formatVersion, 1);
  assert.equal(parsed.recordedTrace.points.length, 1);
  assert.equal(parsed.recordedTrace.points[0].quality, "VALID");
  assert.equal(parsed.recordedTrace.points[0].appState, "FOREGROUND");
});

function exportEnvironment({ share, canShare } = {}) {
  const calls = { shared: 0, downloaded: 0, revoked: 0, files: [] };
  const link = { href: "", download: "", click: () => { calls.downloaded += 1; }, remove: () => undefined };
  return {
    calls,
    environment: {
      share: share ? async (data) => { calls.shared += 1; calls.files = data.files; await share(data); } : undefined,
      canShare,
      createObjectUrl: () => "blob:bcflight",
      revokeObjectUrl: () => { calls.revoked += 1; },
      createDownloadLink: () => link,
      scheduleCleanup: (callback) => callback(),
    },
  };
}

test("le clic est branché et le payload Blob est généré", async () => {
  const source = readFileSync(new URL("../flights/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=.*[\s\S]*exportBcFlight\(flight\)/);
  const payload = JSON.parse(await createBcFlightBlob(existingFlight()).text());
  assert.equal(payload.format, "BCFLIGHT");
});

test("share fichiers supporté appelle la feuille de partage", async () => {
  const { calls, environment } = exportEnvironment({ share: async () => undefined, canShare: () => true });
  assert.equal(await exportBcFlight(existingFlight(), environment), "SHARED");
  assert.equal(calls.shared, 1);
  assert.equal(calls.downloaded, 0);
  assert.equal(calls.files[0].name.endsWith(".bcflight"), true);
});

test("share non supporté déclenche le téléchargement", async () => {
  const { calls, environment } = exportEnvironment({ canShare: () => false });
  assert.equal(await exportBcFlight(existingFlight(), environment), "DOWNLOADED");
  assert.equal(calls.downloaded, 1);
  assert.equal(calls.revoked, 1);
});

test("un échec de share déclenche automatiquement le téléchargement", async () => {
  const { calls, environment } = exportEnvironment({ share: async () => { throw new Error("iOS share failed"); }, canShare: () => true });
  assert.equal(await exportBcFlight(existingFlight(), environment), "DOWNLOADED");
  assert.equal(calls.shared, 1);
  assert.equal(calls.downloaded, 1);
});

test("l'export ne référence aucun stockage applicatif", () => {
  const source = readFileSync(new URL("./bcFlightExport.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /IndexedDB|localStorage|sessionStorage|saveActiveFlight|completeFlight|Journal|Carnet/i);
});

test("n'exporte ni secret, ni session Auth, ni donnée d'un autre vol", () => {
  const serialized = JSON.stringify(createBcFlightExport(existingFlight()));
  assert.doesNotMatch(serialized, /access[_-]?token|refresh[_-]?token|api[_-]?key|supabase|auth|sessionUser|password/i);
  assert.doesNotMatch(serialized, /another-flight/);
});

test("un ancien vol sans quality reste exportable sans inventer ces champs", async () => {
  const file = createBcFlightFile(existingFlight({ legacy: true }));
  const parsed = JSON.parse(await file.text());
  assert.equal(parsed.recordedTrace.points.length, 1);
  assert.equal(parsed.recordedTrace.points[0].quality, undefined);
  assert.equal(parsed.metadata.parameters.legacyPointsWithoutQuality, "TREATED_AS_VALID");
});
