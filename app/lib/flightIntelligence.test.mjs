import assert from "node:assert/strict";
import test from "node:test";
import { createFlightSession } from "./flightCore/createFlightSession.ts";
import { ConfidenceEngine } from "./flightIntelligence/confidenceEngine.ts";
import { ConsistencyEngine } from "./flightIntelligence/consistencyEngine.ts";
import { extractFlightFacts } from "./flightIntelligence/flightFacts.ts";
import { FlightTimeline } from "./flightIntelligence/flightTimeline.ts";
import { ObservationEngine } from "./flightIntelligence/observationEngine.ts";

const metrics = {
  altitude: null,
  verticalSpeed: null,
  groundSpeed: null,
  heading: null,
  durationSeconds: 0,
  distanceKm: 0,
  lastUpdated: 0,
};

const flightContext = {
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

function makeSession(overrides = {}) {
  return createFlightSession({
    status: "ready",
    storageReady: true,
    storageError: null,
    activeFlight: null,
    recoverableFlight: null,
    completedFlight: null,
    points: [],
    metrics,
    currentPosition: null,
    geolocationState: "idle",
    isPositionStale: false,
    gpsProjection: [],
    weatherProjection: [],
    plannedTrajectories: [],
    flightContext,
    ...overrides,
  });
}

test("FlightFacts conserve exactement les données du snapshot", () => {
  const session = makeSession();
  const facts = extractFlightFacts(session);
  assert.equal(facts.status, session.state.status);
  assert.equal(facts.phase, session.phase);
  assert.equal(facts.trackPointCount, session.trajectory.points.length);
  assert.equal(facts.currentAirspaceId, null);
});

test("ConfidenceEngine distingue GPS frais, imprécis et ancien", () => {
  const engine = new ConfidenceEngine();
  const facts = extractFlightFacts(makeSession());
  assert.equal(
    engine.evaluate({
      source: {
        kind: "GPS",
        timestamp: 1_000,
        horizontalAccuracyMeters: 8,
        isStale: false,
      },
      facts,
    }),
    "HIGH",
  );
  assert.equal(
    engine.evaluate({
      source: {
        kind: "GPS",
        timestamp: 1_000,
        horizontalAccuracyMeters: 8,
        isStale: true,
      },
      facts,
    }),
    "LOW",
  );
});

test("ConsistencyEngine observe sans corriger une projection sans position", () => {
  const session = makeSession({
    gpsProjection: [{ minutes: 5, latitude: 50.6, longitude: 3.1 }],
  });
  const issues = new ConsistencyEngine().evaluate(
    session,
    extractFlightFacts(session),
  );
  assert.equal(issues[0]?.code, "PROJECTION_WITHOUT_CURRENT_POSITION");
  assert.equal(session.projections.gps.length, 1);
});

test("FlightTimeline est déterministe et chronologique", () => {
  const point = {
    latitude: 50.6,
    longitude: 3.1,
    altitude: 100,
    speed: 2,
    heading: 90,
    accuracy: 8,
    verticalAccuracy: 10,
    timestamp: 2_000,
  };
  const session = makeSession({
    currentPosition: point,
    geolocationState: "active",
    points: [point],
    metrics: { ...metrics, lastUpdated: 2_000 },
  });
  const facts = extractFlightFacts(session);
  const first = FlightTimeline.fromSession(session, facts);
  const second = FlightTimeline.fromSession(session, facts);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((entry) => entry.timestamp),
    [...first].map((entry) => entry.timestamp).sort((a, b) => a - b),
  );
});

test("ObservationEngine produit uniquement des faits non prescriptifs", () => {
  const result = new ObservationEngine().observe(makeSession());
  assert.ok(
    result.observations.some(
      (observation) => observation.id === "position:unavailable",
    ),
  );
  assert.ok(
    result.observations.every(
      (observation) =>
        !/\b(?:devez|devrait|montez|descendez|atterrissez)\b/i.test(
          observation.statement,
        ),
    ),
  );
});

test("ObservationEngine ne modifie jamais FlightSession", () => {
  const session = makeSession();
  const before = structuredClone(session);
  new ObservationEngine().observe(session);
  assert.deepEqual(session, before);
});
