import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildJournalChartPath, buildJournalTimeAxis, formatJournalTimeTick, formatJournalTooltipTime, formatJournalTooltipValue, journalChartSampleTolerance, selectJournalChartPoint } from "./journalChart.ts";
import { journalSpeedKmh, recordedFlightPointsToJournalPoints } from "./realFlightJournal.ts";
import { kmhToKnots, metresToFeet } from "./unitPreferences.ts";

test("un vol de 55,603683 minutes reçoit un axe entier lisible", () => {
  const axis = buildJournalTimeAxis(55.603683333333336);
  assert.deepEqual(axis, { maximumMinutes: 56, ticks: [0, 10, 20, 30, 40, 50, 56] });
  assert.equal(formatJournalTimeTick(axis.ticks.at(-1), false, true), "56 min");
  assert.ok(axis.ticks.every(Number.isInteger));
  assert.ok(axis.ticks.length <= 7);
});

test("l'axe reste adaptatif aux vols courts et longs sans ticks voisins superposés", () => {
  assert.deepEqual(buildJournalTimeAxis(4.2), { maximumMinutes: 5, ticks: [0, 1, 2, 3, 5] });
  assert.deepEqual(buildJournalTimeAxis(90).ticks, [0, 15, 30, 45, 60, 75, 90]);
  const long = buildJournalTimeAxis(245);
  assert.ok(long.ticks.length <= 7);
  assert.equal(formatJournalTimeTick(120, true, false), "2 h");
  assert.equal(formatJournalTimeTick(245, true, true), "4 h 05");
});

test("une mesure manquante casse la ligne tandis qu'un vrai zéro reste tracé", () => {
  const path = buildJournalChartPath([
    { x: 0, y: 18 },
    { x: 1, y: null },
    { x: 2, y: 0 },
    { x: 3, y: 17 },
  ], 3, 30);
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.match(path, /M66\.17 96\.00 L98\.50 43\.87$/);
});

test("l'exploration sélectionne le point temporel réel le plus proche, pas son index", () => {
  const points = [{ x: 0, y: 10 }, { x: 0.2, y: 11 }, { x: 2, y: 12 }];
  assert.equal(selectJournalChartPoint(points, 0.3)?.timePoint.x, 0.2);
  assert.equal(selectJournalChartPoint(points, 1.8)?.timePoint.x, 2);
});

test("le tooltip formate le temps écoulé et respecte les unités pilote", () => {
  assert.equal(formatJournalTooltipTime(32 / 60), "0 min 32 s");
  assert.equal(formatJournalTooltipTime(14 + 32 / 60), "14 min 32 s");
  assert.equal(formatJournalTooltipTime(64 + 18 / 60), "1 h 04 min 18 s");
  assert.match(formatJournalTooltipValue(metresToFeet(1042), "ft", 0), /^3[\s\u202f]419 ft$/);
  assert.equal(formatJournalTooltipValue(22.4, "km/h", 1), "22,4 km/h");
  assert.equal(formatJournalTooltipValue(kmhToKnots(22.4), "kt", 1), "12,1 kt");
});

test("une vitesse absente reste indisponible tandis qu'un vrai zéro est sélectionnable", () => {
  const points = [{ x: 0, y: 0 }, { x: 1, y: null }, { x: 2, y: 12 }];
  assert.equal(journalChartSampleTolerance(points), 0.25);
  assert.equal(selectJournalChartPoint(points, 0)?.valuePoint?.y, 0);
  assert.equal(selectJournalChartPoint(points, 1)?.valuePoint, null);
});

test("le geste pointer est continu et laisse le défilement vertical au navigateur", () => {
  const component = readFileSync(new URL("../components/journal/JournalChart.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../journal/Journal.module.css", import.meta.url), "utf8");
  assert.match(component, /onPointerDown=/);
  assert.match(component, /onPointerMove=/);
  assert.match(component, /onPointerUp=/);
  assert.match(component, /onPointerCancel=/);
  assert.match(component, /requestAnimationFrame/);
  assert.match(css, /touch-action:\s*pan-y/);
});

test("la préparation vitesse conserve le vrai zéro et écarte seulement l'absence ou la qualité GPS non fiable", () => {
  const base = {
    timestamp: 1_000,
    latitude: 50,
    longitude: 3,
    altitudeMeters: 100,
    headingDegrees: 90,
    horizontalAccuracyMeters: 5,
    verticalAccuracyMeters: 8,
  };
  assert.equal(journalSpeedKmh({ ...base, speedMetersPerSecond: 0, quality: "VALID", qualityReason: "NONE" }), 0);
  assert.equal(journalSpeedKmh({ ...base, speedMetersPerSecond: null, quality: "VALID", qualityReason: "NONE" }), null);
  assert.equal(journalSpeedKmh({ ...base, speedMetersPerSecond: 5, quality: "SUSPECT", qualityReason: "SPEED_OUTLIER" }), null);
  assert.equal(journalSpeedKmh({ ...base, speedMetersPerSecond: 5, quality: "SUSPECT", qualityReason: "ALTITUDE_SPIKE" }), 18);
});

test("la conversion du RecordedFlight ne mute jamais les données sources", () => {
  const source = {
    id: "flight",
    schemaVersion: 1,
    status: "COMPLETED",
    startedAt: 1_000,
    endedAt: 3_000,
    points: [
      { timestamp: 1_000, latitude: 50, longitude: 3, altitudeMeters: 100, speedMetersPerSecond: 0, headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8, quality: "VALID", qualityReason: "NONE" },
      { timestamp: 2_000, latitude: 50.001, longitude: 3.001, altitudeMeters: 101, speedMetersPerSecond: null, headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8, quality: "VALID", qualityReason: "NONE" },
    ],
    summary: { durationSeconds: 2, distanceMeters: 10, minAltitudeMeters: 100, maxAltitudeMeters: 101, averageGroundSpeedMetersPerSecond: 0, maxGroundSpeedMetersPerSecond: 0 },
    createdAt: 1_000,
    updatedAt: 3_000,
  };
  const snapshot = structuredClone(source);
  assert.deepEqual(recordedFlightPointsToJournalPoints(source).map(({ speedKmh }) => speedKmh), [0, null]);
  assert.deepEqual(source, snapshot);
});
