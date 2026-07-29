import assert from "node:assert/strict";
import test from "node:test";
import { createFlightSession } from "./flightCore/createFlightSession.ts";
import { extractFlightFacts } from "./flightIntelligence/flightFacts.ts";
import { FlightTimeline } from "./flightIntelligence/flightTimeline.ts";
import { ObservationEngine } from "./flightIntelligence/observationEngine.ts";
import {
  FlightRecordBuildError,
} from "./flightRecord/entities.ts";
import { FlightRecordBuilder } from "./flightRecord/flightRecordBuilder.ts";

const point = {
  latitude: 50.63,
  longitude: 3.05,
  altitude: 620,
  speed: 3,
  heading: 245,
  accuracy: 8,
  verticalAccuracy: 12,
  timestamp: 2_000,
};

const completedFlight = {
  id: "flight-record-test",
  schemaVersion: 1,
  status: "COMPLETED",
  startedAt: 1_000,
  endedAt: 3_000,
  points: [
    {
      timestamp: point.timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
      altitudeMeters: point.altitude,
      speedMetersPerSecond: point.speed,
      headingDegrees: point.heading,
      horizontalAccuracyMeters: point.accuracy,
      verticalAccuracyMeters: point.verticalAccuracy,
    },
  ],
  summary: {
    durationSeconds: 2,
    distanceMeters: 0,
    minAltitudeMeters: 620,
    maxAltitudeMeters: 620,
    averageGroundSpeedMetersPerSecond: null,
    maxGroundSpeedMetersPerSecond: 3,
  },
  createdAt: 1_000,
  updatedAt: 3_000,
};

const flightContext = {
  gps: {
    latitude: point.latitude,
    longitude: point.longitude,
    altitudeMeters: point.altitude,
    horizontalAccuracyMeters: point.accuracy,
    verticalAccuracyMeters: point.verticalAccuracy,
    timestamp: point.timestamp,
    status: "ACTIVE",
  },
  airspace: {
    current: null,
    containing: [],
    horizontalCandidates: [],
    status: "NO_MATCH",
  },
};

function completedSources() {
  const session = createFlightSession({
    status: "stopped",
    storageReady: true,
    storageError: null,
    activeFlight: null,
    recoverableFlight: null,
    completedFlight,
    points: [point],
    metrics: {
      altitude: point.altitude,
      verticalSpeed: 0,
      groundSpeed: point.speed,
      heading: point.heading,
      durationSeconds: 2,
      distanceKm: 0,
      lastUpdated: 3_000,
    },
    currentPosition: point,
    geolocationState: "active",
    isPositionStale: false,
    gpsProjection: [],
    weatherProjection: [],
    plannedTrajectories: [],
    flightContext,
  });
  const intelligence = new ObservationEngine().observe(session);
  return {
    session,
    facts: intelligence.facts,
    timeline: intelligence.timeline,
    observations: intelligence.observations,
  };
}

test("construit l’archive complète d’un vol terminé", () => {
  const record = new FlightRecordBuilder().build(completedSources());
  assert.equal(record.metadata.schemaVersion, 1);
  assert.equal(record.identity.flightId, "flight-record-test");
  assert.equal(record.identity.endedAt, 3_000);
  assert.equal(record.metadata.counts.trackPoints, 1);
  assert.equal(record.aircraft.status, "UNAVAILABLE");
  assert.deepEqual(record.media.items, []);
});

test("copie les sources avant de les archiver", () => {
  const sources = completedSources();
  const record = new FlightRecordBuilder().build(sources);
  assert.notEqual(record.session, sources.session);
  assert.notEqual(record.facts, sources.facts);
  assert.notEqual(record.timeline, sources.timeline);
  assert.deepEqual(record.session, sources.session);
});

test("fige récursivement le FlightRecord", () => {
  const record = new FlightRecordBuilder().build(completedSources());
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.session), true);
  assert.equal(Object.isFrozen(record.session.trajectory.points), true);
  assert.equal(Object.isFrozen(record.observations), true);
});

test("produit une signature déterministe", () => {
  const builder = new FlightRecordBuilder();
  const first = builder.build(completedSources());
  const second = builder.build(completedSources());
  assert.equal(first.signature.value, second.signature.value);
  assert.match(first.signature.value, /^[0-9a-f]{8}$/);
});

test("refuse un vol non terminé", () => {
  const sources = completedSources();
  const incomplete = {
    ...sources,
    session: {
      ...sources.session,
      phase: "CRUISE",
    },
  };
  assert.throws(
    () => new FlightRecordBuilder().build(incomplete),
    (error) =>
      error instanceof FlightRecordBuildError &&
      error.code === "FLIGHT_NOT_COMPLETED",
  );
});

test("refuse des sources décrivant des vols différents", () => {
  const sources = completedSources();
  const facts = extractFlightFacts(sources.session);
  const mismatched = {
    ...sources,
    facts: {
      ...facts,
      sessionId: "another-flight",
    },
    timeline: FlightTimeline.fromSession(sources.session, facts),
  };
  assert.throws(
    () => new FlightRecordBuilder().build(mismatched),
    (error) =>
      error instanceof FlightRecordBuildError &&
      error.code === "SOURCE_ID_MISMATCH",
  );
});
