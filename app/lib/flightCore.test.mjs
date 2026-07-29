import assert from "node:assert/strict";
import test from "node:test";
import {
  createFlightSession,
  resolveFlightPhase,
} from "./flightCore/createFlightSession.ts";

const metrics = {
  altitude: 620,
  verticalSpeed: 0,
  groundSpeed: 3,
  heading: 245,
  durationSeconds: 180,
  distanceKm: 0.8,
  lastUpdated: 1_000,
};

const emptyContext = {
  gps: {
    latitude: null,
    longitude: null,
    altitudeMeters: null,
    horizontalAccuracyMeters: null,
    verticalAccuracyMeters: null,
    timestamp: null,
    status: "UNAVAILABLE",
  },
  airspace: {
    current: null,
    containing: [],
    horizontalCandidates: [],
    status: "UNAVAILABLE",
  },
};

test("conserve les seuils visuels historiques du vario", () => {
  assert.equal(
    resolveFlightPhase({
      status: "recording",
      verticalSpeedMetersPerSecond: 0.21,
      hasCompletedFlight: false,
    }),
    "CLIMB",
  );
  assert.equal(
    resolveFlightPhase({
      status: "recording",
      verticalSpeedMetersPerSecond: -0.21,
      hasCompletedFlight: false,
    }),
    "DESCENT",
  );
  assert.equal(
    resolveFlightPhase({
      status: "recording",
      verticalSpeedMetersPerSecond: 0.2,
      hasCompletedFlight: false,
    }),
    "CRUISE",
  );
});

test("ne déduit jamais une approche à partir de la descente", () => {
  assert.notEqual(
    resolveFlightPhase({
      status: "recording",
      verticalSpeedMetersPerSecond: -2,
      hasCompletedFlight: false,
    }),
    "APPROACH",
  );
});

test("assemble un snapshot sans transformer les valeurs métier", () => {
  const point = {
    latitude: 50.63,
    longitude: 3.05,
    altitude: 620,
    speed: 3,
    heading: 245,
    accuracy: 8,
    verticalAccuracy: 12,
    timestamp: 1_000,
  };
  const session = createFlightSession({
    status: "recording",
    storageReady: true,
    storageError: null,
    activeFlight: null,
    recoverableFlight: null,
    completedFlight: null,
    points: [point],
    metrics,
    currentPosition: point,
    geolocationState: "active",
    isPositionStale: false,
    gpsProjection: [],
    weatherProjection: [],
    plannedTrajectories: [],
    flightContext: emptyContext,
  });

  assert.equal(session.schemaVersion, 1);
  assert.equal(session.altitude.amslMeters, metrics.altitude);
  assert.equal(
    session.motion.verticalSpeedMetersPerSecond,
    metrics.verticalSpeed,
  );
  assert.equal(session.trajectory.points[0], point);
  assert.equal(session.statistics.metrics, metrics);
  assert.equal(session.phase, "CRUISE");
});
