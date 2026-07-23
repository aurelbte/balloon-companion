import assert from "node:assert/strict";
import test from "node:test";
import {
  appendRecordedFlightPoint,
  calculateRecordedFlightSummary,
  canAppendRecordedFlightPoint,
  createRecordedFlight,
  finalizeRecordedFlight,
  interruptRecordedFlight,
  recordedFlightSegmentDistance,
  resumeRecordedFlight,
} from "./recordedFlight.ts";

function point({
  timestamp = 1_000,
  latitude = 50,
  longitude = 3,
  altitudeMeters = 100,
  speedMetersPerSecond = 5,
  horizontalAccuracyMeters = 5,
} = {}) {
  return {
    timestamp,
    latitude,
    longitude,
    altitudeMeters,
    speedMetersPerSecond,
    headingDegrees: 90,
    horizontalAccuracyMeters,
    verticalAccuracyMeters: 8,
  };
}

test("crée un vol et conserve immédiatement son premier point", () => {
  const first = point();
  const flight = createRecordedFlight({
    id: "flight-1",
    startedAt: 1_000,
    firstPoint: first,
  });
  assert.equal(flight.id, "flight-1");
  assert.equal(flight.status, "RECORDING");
  assert.deepEqual(flight.points, [first]);
});

test("ajoute un point valide sans muter le vol initial", () => {
  const flight = createRecordedFlight({ id: "flight", startedAt: 1_000 });
  const result = appendRecordedFlightPoint(flight, point());
  assert.equal(result.acceptance.accepted, true);
  assert.equal(flight.points.length, 0);
  assert.equal(result.flight.points.length, 1);
});

test("rejette un doublon strict et un timestamp antérieur", () => {
  const previous = point({ timestamp: 2_000 });
  assert.equal(
    canAppendRecordedFlightPoint({ ...previous }, previous).reason,
    "STRICT_DUPLICATE",
  );
  assert.equal(
    canAppendRecordedFlightPoint(point({ timestamp: 1_999 }), previous).reason,
    "OLDER_TIMESTAMP",
  );
});

test("un point GPS invalide ne supprime pas les points existants", () => {
  const flight = createRecordedFlight({
    id: "flight",
    firstPoint: point(),
  });
  const result = appendRecordedFlightPoint(
    flight,
    point({ latitude: 200, timestamp: 2_000 }),
  );
  assert.equal(result.acceptance.accepted, false);
  assert.equal(result.flight, flight);
  assert.equal(result.flight.points.length, 1);
});

test("rejette une acquisition imprécise et un saut manifestement impossible", () => {
  const previous = point();
  assert.equal(
    canAppendRecordedFlightPoint(
      point({ timestamp: 2_000, horizontalAccuracyMeters: 150 }),
      previous,
    ).reason,
    "INACCURATE",
  );
  assert.equal(
    canAppendRecordedFlightPoint(
      point({ timestamp: 2_000, latitude: 51 }),
      previous,
    ).reason,
    "IMPOSSIBLE_JUMP",
  );
});

test("calcule distance, durée, altitudes et vitesses", () => {
  const summary = calculateRecordedFlightSummary(
    [
      point({ timestamp: 1_000, longitude: 3, altitudeMeters: 100, speedMetersPerSecond: 4 }),
      point({ timestamp: 11_000, longitude: 3.001, altitudeMeters: 180, speedMetersPerSecond: 8 }),
    ],
    1_000,
    21_000,
  );
  assert.ok(summary.distanceMeters > 70);
  assert.equal(summary.durationSeconds, 20);
  assert.equal(summary.minAltitudeMeters, 100);
  assert.equal(summary.maxAltitudeMeters, 180);
  assert.ok(summary.averageGroundSpeedMetersPerSecond > 7);
  assert.equal(summary.maxGroundSpeedMetersPerSecond, 8);
});

test("conserve les points mais ignore la micro-dérive GPS à l’arrêt", () => {
  const first = point({
    speedMetersPerSecond: 0.1,
    horizontalAccuracyMeters: 10,
  });
  const second = point({
    timestamp: 2_000,
    latitude: 50.00002,
    speedMetersPerSecond: 0.1,
    horizontalAccuracyMeters: 10,
  });
  assert.equal(recordedFlightSegmentDistance(first, second), 0);
  const summary = calculateRecordedFlightSummary(
    [first, second],
    1_000,
    2_000,
  );
  assert.equal(summary.distanceMeters, 0);
});

test("gère un vol sans altitude ou sans vitesse", () => {
  const summary = calculateRecordedFlightSummary(
    [
      point({ altitudeMeters: null, speedMetersPerSecond: null }),
      point({ timestamp: 2_000, altitudeMeters: null, speedMetersPerSecond: null }),
    ],
    1_000,
    2_000,
  );
  assert.equal(summary.minAltitudeMeters, null);
  assert.equal(summary.maxAltitudeMeters, null);
  assert.equal(summary.maxGroundSpeedMetersPerSecond, null);
});

test("finalise un vol sans perdre ses points", () => {
  const flight = createRecordedFlight({
    id: "flight",
    startedAt: 1_000,
    firstPoint: point(),
  });
  const completed = finalizeRecordedFlight(flight, 10_000);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.endedAt, 10_000);
  assert.deepEqual(completed.points, flight.points);
});

test("interrompt puis reprend le même vol", () => {
  const flight = createRecordedFlight({ id: "same-flight", startedAt: 1_000 });
  const interrupted = interruptRecordedFlight(flight, 2_000);
  const resumed = resumeRecordedFlight(interrupted, 3_000);
  assert.equal(interrupted.status, "INTERRUPTED");
  assert.equal(resumed.status, "RECORDING");
  assert.equal(resumed.id, flight.id);
  assert.equal(resumed.startedAt, flight.startedAt);
});

test("une erreur de résumé ne remplace jamais la trace", () => {
  const flight = createRecordedFlight({ id: "flight", startedAt: 1_000 });
  const brokenPoints = new Proxy(flight.points, {
    get(target, property, receiver) {
      if (property === "length") throw new Error("Résumé indisponible");
      return Reflect.get(target, property, receiver);
    },
  });
  const brokenFlight = { ...flight, points: brokenPoints };
  const completed = finalizeRecordedFlight(brokenFlight, 2_000);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.points, brokenPoints);
});
