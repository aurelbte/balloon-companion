import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createBcFlightExport } from "./bcFlightExport.ts";
import { BcFlightImportError, parseBcFlight } from "./bcFlightImport.ts";
import { createRecordedFlight, finalizeRecordedFlight, recalculateFlightStatistics } from "./recordedFlight.ts";
import { classifyGpsTraceQuality } from "./gpsPointQuality.ts";

function exportText({ legacy = false, notes } = {}) {
  const point = {
    timestamp: 1_000, latitude: 50, longitude: 3, altitudeMeters: 100,
    speedMetersPerSecond: 5, headingDegrees: 90,
    horizontalAccuracyMeters: 5, verticalAccuracyMeters: 8,
    ...(legacy ? {} : { quality: "VALID", qualityReason: "NONE" }),
  };
  const flight = { ...finalizeRecordedFlight(createRecordedFlight({ id: "import", startedAt: 1_000, firstPoint: point }), 2_000), ...(notes ? { notes } : {}) };
  return JSON.stringify(createBcFlightExport(flight, new Date("2026-08-10T10:00:00Z")));
}

test("un fichier valide est accepté et recalculé", () => {
  const imported = parseBcFlight(exportText());
  assert.equal(imported.flight.id, "import");
  assert.deepEqual(
    imported.diagnostic.newStatistics,
    recalculateFlightStatistics(classifyGpsTraceQuality(imported.flight.points), imported.flight.startedAt, imported.flight.endedAt),
  );
});

test("la note optionnelle effectue un aller-retour BCFLIGHT v1", () => {
  assert.equal(parseBcFlight(exportText()).flight.notes, undefined);
  assert.equal(parseBcFlight(exportText({ notes: "Vol calme" })).flight.notes, "Vol calme");
});

test("un mauvais format est refusé clairement", () => {
  assert.throws(() => parseBcFlight('{"format":"OTHER","formatVersion":1}'),
    (error) => error instanceof BcFlightImportError && error.code === "INVALID_FORMAT");
});

test("une version inconnue est refusée proprement", () => {
  assert.throws(() => parseBcFlight('{"format":"BCFLIGHT","formatVersion":99}'),
    (error) => error instanceof BcFlightImportError && error.code === "UNSUPPORTED_VERSION");
});

test("un ancien vol sans quality est recalculable et la trace source reste intacte", () => {
  const source = exportText({ legacy: true });
  const before = JSON.parse(source).recordedTrace.points;
  const imported = parseBcFlight(source);
  assert.equal(imported.diagnostic.pointCounts.total, 1);
  assert.deepEqual(JSON.parse(source).recordedTrace.points, before);
});

test("le flux d'import ne référence aucun stockage ni Journal", () => {
  const sources = ["./bcFlightImport.ts", "../debug/bcflight/BcFlightImporter.tsx"]
    .map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(sources, /IndexedDB|localStorage|sessionStorage|RecordedFlightStorage|Journal|Carnet|saveActiveFlight|completeFlight/i);
});
