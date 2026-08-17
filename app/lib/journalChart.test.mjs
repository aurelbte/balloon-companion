import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildJournalChartPath, buildJournalTimeAxis, formatJournalTimeTick, formatJournalTooltipTime, formatJournalTooltipValue, journalChartDurationMinutes, journalChartSampleTolerance, journalChartTimeFromPointer, journalChartTimeFromPointerX, selectJournalChartPoint } from "./journalChart.ts";
import { journalSpeedKmh, recordedFlightPointsToJournalPoints } from "./realFlightJournal.ts";
import { kmhToKnots, metresToFeet } from "./unitPreferences.ts";

test("un vol de 55,603683 minutes reçoit un axe entier lisible", () => {
  const axis = buildJournalTimeAxis(55.603683333333336);
  assert.deepEqual(axis, { maximumMinutes: 56, ticks: [0, 10, 20, 30, 40, 50, 56] });
  assert.equal(formatJournalTimeTick(axis.ticks.at(-1), false, true), "56 min");
  assert.ok(axis.ticks.every(Number.isInteger));
  assert.ok(axis.ticks.length <= 7);
});

test("le domaine temporel vient des samples et ignore une durée de métadonnée incohérente", () => {
  const points = [{ elapsedMinutes: 0 }, { elapsedMinutes: 55.603683333333336 }];
  const durationMinutes = journalChartDurationMinutes(points);
  const axis = buildJournalTimeAxis(durationMinutes);
  assert.equal(durationMinutes, 55.603683333333336);
  assert.equal(axis.maximumMinutes, 56);
  assert.ok(axis.maximumMinutes < 62, "un vol proche d'une heure ne doit jamais être étendu vers cinq heures");
});

test("les durées réelles de 61, 90 et 300 minutes gardent une fin exacte et lisible", () => {
  for (const [duration, expectedTicks, expectedLabel] of [
    [61, [0, 15, 30, 45, 61], "1 h 01"],
    [90, [0, 15, 30, 45, 60, 75, 90], "1 h 30"],
    [300, [0, 60, 120, 180, 240, 300], "5 h"],
  ]) {
    const axis = buildJournalTimeAxis(duration);
    assert.deepEqual(axis.ticks, expectedTicks);
    assert.equal(formatJournalTimeTick(axis.ticks.at(-1), axis.maximumMinutes >= 60, true), expectedLabel);
    assert.ok(axis.ticks.every(Number.isInteger));
    assert.ok(axis.ticks.length <= 7);
  }
});

test("altitude et vitesse partagent le domaine calculé une seule fois depuis la trace", () => {
  const component = readFileSync(new URL("../components/journal/JournalFlightGraphs.tsx", import.meta.url), "utf8");
  assert.equal((component.match(/journalChartDurationMinutes\(points\)/g) ?? []).length, 1);
  assert.equal((component.match(/durationMinutes=\{durationMinutes\}/g) ?? []).length, 2);
  assert.doesNotMatch(component, /Math\.max\([^\n]*flight\.durationMinutes/);
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

test("la sélection dépend uniquement de X sur toute la hauteur du tracé", () => {
  const centerTimes = [10, 50, 90].map((clientY) => journalChartTimeFromPointer({ clientX: 160, clientY }, 20, 280, 60));
  assert.deepEqual(centerTimes, [30, 30, 30]);
  const dragTimes = [20, 40, 60, 80].map((percent) => journalChartTimeFromPointer({ clientX: 20 + 280 * percent / 100, clientY: 50 }, 20, 280, 60));
  assert.deepEqual(dragTimes, [12, 24, 36, 48]);
  assert.equal(journalChartTimeFromPointerX(230, 20, 280, 60), 45);
});

test("le tooltip reste fixe tandis que curseur et marqueur suivent le sample", () => {
  const component = readFileSync(new URL("../components/journal/JournalChart.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../journal/Journal.module.css", import.meta.url), "utf8");
  assert.match(component, /journalChartTimeFromPointer\(event,/);
  assert.doesNotMatch(component, /event\.clientY/);
  assert.match(component, /chartMarker[^\n]*left: `\$\{cursorLeft\}%`[^\n]*top: `\$\{markerTop\}%`/);
  assert.match(component, /<output className=\{styles\.chartTooltip\}>/);
  assert.doesNotMatch(component, /<output[^>]*style=/);
  assert.match(css, /\.chartTooltip\s*\{[\s\S]*?top:\s*12px;[\s\S]*?left:\s*50%;[\s\S]*?padding:\s*12px 16px;/);
});

test("altitude conserve tous les samples temporels comme la vitesse", () => {
  const graphs = readFileSync(new URL("../components/journal/JournalFlightGraphs.tsx", import.meta.url), "utf8");
  assert.match(graphs, /const altitude = points\.map/);
  assert.doesNotMatch(graphs, /const altitude = points\.filter/);
  assert.match(graphs, /tooltipTimePrefix="Temps de vol : "/);
});

test("le tooltip formate le temps écoulé et respecte les unités pilote", () => {
  assert.equal(formatJournalTooltipTime(32 / 60), "0 min 32 s");
  assert.equal(formatJournalTooltipTime(14 + 32 / 60), "14 min 32 s");
  assert.equal(formatJournalTooltipTime(64 + 18 / 60), "1 h 04 min 18 s");
  assert.match(formatJournalTooltipValue(metresToFeet(1042), "ft", 0), /^3[\s\u202f]419 ft$/);
  assert.equal(formatJournalTooltipValue(22.4, "km/h", 1), "22,4 km/h");
  assert.equal(formatJournalTooltipValue(kmhToKnots(22.4), "kt", 1), "12,1 kt");
  const graphs = readFileSync(new URL("../components/journal/JournalFlightGraphs.tsx", import.meta.url), "utf8");
  assert.match(graphs, /tooltipLabel="ALTITUDE"/);
  assert.match(graphs, /tooltipLabel="VITESSE SOL"/);
  assert.match(graphs, /axisUnit=\{units\.flightInstruments\.altitudeUnit\}/);
  assert.match(graphs, /axisUnit=\{units\.flightInstruments\.speedUnit\}/);
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

test("le premier sample valide est l'origine temporelle de la présentation", () => {
  const source = {
    id: "delayed-flight", schemaVersion: 1, status: "COMPLETED", startedAt: 1_000, endedAt: 3_601_000,
    points: [
      { timestamp: 301_000, latitude: 50, longitude: 3, altitudeMeters: 100, speedMetersPerSecond: 1, headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8, quality: "VALID", qualityReason: "NONE" },
      { timestamp: 3_601_000, latitude: 50.1, longitude: 3.1, altitudeMeters: 200, speedMetersPerSecond: 1, headingDegrees: 90, horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8, quality: "VALID", qualityReason: "NONE" },
    ],
    summary: { durationSeconds: 3600, distanceMeters: 10, minAltitudeMeters: 100, maxAltitudeMeters: 200, averageGroundSpeedMetersPerSecond: 1, maxGroundSpeedMetersPerSecond: 1 },
    createdAt: 1_000, updatedAt: 3_601_000,
  };
  assert.deepEqual(recordedFlightPointsToJournalPoints(source).map(({ elapsedMinutes }) => elapsedMinutes), [0, 55]);
});
