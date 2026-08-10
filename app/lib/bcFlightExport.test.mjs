import assert from "node:assert/strict";
import test from "node:test";
import { createRecordedFlight, finalizeRecordedFlight } from "./recordedFlight.ts";
import { BCFLIGHT_FORMAT, createBcFlightExport, createBcFlightFile } from "./bcFlightExport.ts";

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
