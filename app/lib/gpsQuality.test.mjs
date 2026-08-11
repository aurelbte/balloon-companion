import assert from "node:assert/strict";
import test from "node:test";
import { GpsQualitySession } from "./gpsQuality.ts";
import {
  geoPointToRecordedFlightPoint,
  recordedFlightPointToGeoPoint,
} from "./recordedFlight.ts";

const point = (timestamp, accuracy = 5) => ({
  timestamp,
  latitude: 50.63,
  longitude: 3.06,
  altitude: 120,
  accuracy,
  verticalAccuracy: 8,
  speed: 4,
  heading: 90,
});

test("un ancien point sans métadonnées qualité reste lisible", () => {
  const legacy = {
    timestamp: 1_000,
    latitude: 50.63,
    longitude: 3.06,
    altitudeMeters: 120,
    horizontalAccuracyMeters: 5,
    verticalAccuracyMeters: 8,
    speedMetersPerSecond: 4,
    headingDegrees: 90,
  };
  assert.deepEqual(recordedFlightPointToGeoPoint(legacy), point(1_000));
});

test("un nouveau point conserve toutes les métadonnées qualité dans la trace", () => {
  const session = new GpsQualitySession();
  const first = session.enrichPoint(point(1_000), 1_025);
  const stored = geoPointToRecordedFlightPoint(first);
  assert.deepEqual(recordedFlightPointToGeoPoint(stored), first);
  assert.equal(stored.appState, "FOREGROUND");
  assert.equal(stored.lastPointTimestamp, 1_000);
  assert.equal(stored.resumedAfterBackground, false);
  assert.equal(stored.firstFixAfterResume, false);
  assert.equal(stored.gpsTimestamp, 1_000);
  assert.equal(stored.receivedAt, 1_025);
  assert.equal(stored.deliveryLatencyMs, 25);
  assert.equal(stored.callbackSequence, 1);
});

test("les callbacks successifs conservent leur provenance et détectent une position répétée", () => {
  const events = [];
  const session = new GpsQualitySession((event, details) => events.push({ event, details }));
  const first = session.enrichPoint(point(1_000), 1_020);
  const repeated = session.enrichPoint(point(2_000), 2_080);

  assert.equal(first.callbackSequence, 1);
  assert.equal(repeated.callbackSequence, 2);
  assert.equal(repeated.sameCoordinatesAsPrevious, true);
  assert.equal(repeated.sameAltitudeAsPrevious, true);
  assert.equal(repeated.sameGpsTimestampAsPrevious, false);
  assert.equal(repeated.deltaGpsTimestampMs, 1_000);
  assert.equal(repeated.deltaReceivedAtMs, 1_060);
  assert.equal(events.some(({ event }) => event === "REPEATED_POSITION"), true);
});

test("background, foreground et premier fix après reprise sont identifiés sans supprimer de point", () => {
  const events = [];
  const session = new GpsQualitySession((event, details) => events.push({ event, details }));
  const before = session.enrichPoint(point(1_000));
  session.enteredBackground(1_100);
  const background = session.enrichPoint(point(2_000));
  session.returnedToForeground(2_100);
  const resumed = session.enrichPoint(point(4_000, 12));
  const next = session.enrichPoint(point(5_000));

  assert.equal(before.appState, "FOREGROUND");
  assert.equal(background.appState, "BACKGROUND");
  assert.equal(resumed.appState, "RESUME");
  assert.equal(resumed.firstFixAfterResume, true);
  assert.equal(resumed.resumedAfterBackground, true);
  assert.equal(resumed.deltaTimeSincePreviousPoint, 2_000);
  assert.equal(next.appState, "FOREGROUND");
  assert.equal(next.firstFixAfterResume, false);
  assert.equal([before, background, resumed, next].length, 4);
  assert.deepEqual(events.map(({ event }) => event).filter((event) =>
    event === "APP_BACKGROUND" ||
    event === "APP_FOREGROUND" ||
    event === "FIRST_FIX_AFTER_RESUME"
  ), [
    "APP_BACKGROUND",
    "APP_FOREGROUND",
    "FIRST_FIX_AFTER_RESUME",
  ]);
  assert.deepEqual(events.find(({ event }) => event === "FIRST_FIX_AFTER_RESUME").details, {
    timestamp: 4_000,
    horizontalAccuracy: 12,
    deltaTimeSincePreviousPoint: 2_000,
  });
});

test("un callback livré plus tard avec le même timestamp est observable sans déduplication", () => {
  const events = [];
  const session = new GpsQualitySession((event, details) => events.push({ event, details }));
  const first = session.enrichPoint(point(1_000), 1_010);
  const second = session.enrichPoint({ ...point(1_000), longitude: 3.061 }, 2_010);

  assert.equal(second.callbackSequence, first.callbackSequence + 1);
  assert.equal(second.sameGpsTimestampAsPrevious, true);
  assert.equal(events.some(({ event }) => event === "LATE_DELIVERY"), true);
});
