import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createGroundCalibration,
  estimateGroundMeters,
  loadTerrainCellWithAccess,
  MAX_TERRAIN_PRELOAD_CELLS,
  terrainCellFor,
  terrainPreloadCells,
  usableAltitudeFix,
} from "./groundElevation.ts";
import { createRecordedFlight } from "./recordedFlight.ts";
import { MemoryRecordedFlightStorage } from "./recordedFlightStorage.ts";
import { getFlightAltitudeReadings } from "./unitPreferences.ts";

const fix = (altitude, timestamp, latitude = 50.63, longitude = 3.06, verticalAccuracy = 8) => ({
  latitude, longitude, altitude, verticalAccuracy, accuracy: 5, speed: 0, heading: null, timestamp,
});

test("calibre le GNSS par médiane sur cinq fixes stables", () => {
  const calibration = createGroundCalibration([143, 145, 146, 144, 147].map((altitude, index) => fix(altitude, index)), 100, 1_000);
  assert.ok(calibration);
  assert.equal(calibration.offsetMeters, 45);
  assert.equal(calibration.fixCount, 5);
});

test("le GND suit le relief sans modifier l'altitude GNSS", () => {
  const calibration = { version: 1, offsetMeters: 45, departureTerrainElevationMeters: 100, calibratedAt: 1_000, fixCount: 5 };
  const inFlight = [394, 395, 396].map((altitude, index) => fix(altitude, index));
  assert.equal(estimateGroundMeters(inFlight, calibration, 100), 350);
  assert.equal(estimateGroundMeters(inFlight, calibration, 180), 270);
  assert.equal(estimateGroundMeters(inFlight, calibration, null), null);
});

test("écarte les fixes sans altitudeAccuracy exploitable", () => {
  assert.equal(usableAltitudeFix(fix(145, 1)), true);
  assert.equal(usableAltitudeFix(fix(145, 1, 50.63, 3.06, null)), false);
  assert.equal(usableAltitudeFix(fix(145, 1, 50.63, 3.06, -1)), false);
  assert.equal(usableAltitudeFix(fix(145, 1, 50.63, 3.06, 101)), false);
});

test("sert une cellule connue sans réseau et échoue silencieusement hors ligne", async () => {
  const spatial = terrainCellFor(50.63, 3.06);
  const cached = { ...spatial, elevationMeters: 100, source: "Open-Meteo", fetchedAt: "2026-08-14T00:00:00Z" };
  let fetchCount = 0;
  const fromCache = await loadTerrainCellWithAccess(spatial, undefined, {
    read: async () => cached,
    write: async () => {},
    fetch: async () => { fetchCount += 1; throw new Error("unexpected"); },
  });
  assert.equal(fromCache.source, "cache");
  assert.equal(fetchCount, 0);

  const offline = await loadTerrainCellWithAccess(spatial, undefined, {
    read: async () => null,
    write: async () => {},
    fetch: async () => { fetchCount += 1; throw new Error("offline"); },
  });
  assert.equal(offline.cell, null);
  assert.equal(offline.source, "unavailable");
  assert.equal(fetchCount, 1);
});

test("déduplique et plafonne le corridor terrain", () => {
  const geometry = Array.from({ length: 200 }, (_, index) => [3.06, 50.63 + index * 0.002]);
  const cells = terrainPreloadCells([{ traceId: "trace", geometry }]);
  assert.equal(cells.length, MAX_TERRAIN_PRELOAD_CELLS);
  assert.equal(new Set(cells.map(({ id }) => id)).size, cells.length);
});

test("l'instrument affiche la même ALT GPS en mètres et pieds selon la préférence", () => {
  const instruments = readFileSync(new URL("../components/flight/FlightInstruments.tsx", import.meta.url), "utf8");
  const flightPage = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const geolocation = readFileSync(new URL("../hooks/useGeolocation.ts", import.meta.url), "utf8");
  assert.deepEqual(getFlightAltitudeReadings(350, "m"), { primary: { value: "350", unit: "m" }, secondary: { value: "1 148", unit: "ft" } });
  assert.deepEqual(getFlightAltitudeReadings(350, "ft"), { primary: { value: "1 148", unit: "ft" }, secondary: { value: "350", unit: "m" } });
  assert.deepEqual(getFlightAltitudeReadings(-10, "m"), { primary: { value: "-10", unit: "m" }, secondary: { value: "-33", unit: "ft" } });
  assert.equal(getFlightAltitudeReadings(null, "m"), null);
  assert.match(instruments, /getFlightAltitudeReadings\(metrics\.altitude/);
  assert.doesNotMatch(instruments, /GND estimé|groundMeters/);
  assert.match(instruments, />QNH</);
  assert.doesNotMatch(flightPage, /useGroundEstimate|groundMeters|setGroundCalibration/);
  assert.match(geolocation, /altitude: altitude !== null \? altitude : null/);
  assert.match(geolocation, /altitudeAccuracy !== null && Number\.isFinite\(altitudeAccuracy\)/);
});

test("la calibration appartient au vol actif et survit à sa restauration", async () => {
  const storage = new MemoryRecordedFlightStorage();
  const groundCalibration = { version: 1, offsetMeters: 45, departureTerrainElevationMeters: 100, calibratedAt: 1_000, fixCount: 5 };
  await storage.saveActiveFlight({ ...createRecordedFlight({ id: "ground-flight", startedAt: 1_000 }), groundCalibration });
  const restored = await storage.getActiveFlight();
  assert.deepEqual(restored?.groundCalibration, groundCalibration);
  assert.notEqual(restored?.groundCalibration, groundCalibration);
});
