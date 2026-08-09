import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { appendRecordedFlightPoint, createRecordedFlight, finalizeRecordedFlight } from "./recordedFlight.ts";
import { createEmptyFlightCompletionState, ensureCompletionJournalFlight } from "./flightCompletion.ts";
import { journalFlightsForMode, legacyFlightSessionToRecordedFlight, recordedFlightPointsToJournalPoints, recordedFlightToJournalFlight } from "./realFlightJournal.ts";

function longRecordedFlight() {
  const startedAt = Date.UTC(2026, 7, 2, 5, 30);
  let flight = createRecordedFlight({ id: "real-flight-2026-08-02", startedAt, balloonRegistration: "F-HLFM" });
  for (let index = 0; index < 420; index += 1) {
    const result = appendRecordedFlightPoint(flight, {
      timestamp: startedAt + index * 10_000,
      latitude: 50.68 + index * 0.00035,
      longitude: 3.08 + index * 0.0011,
      altitudeMeters: 50 + Math.sin((index / 419) * Math.PI) * 900,
      speedMetersPerSecond: 9,
      headingDegrees: 75,
      horizontalAccuracyMeters: 8,
      verticalAccuracyMeters: 12,
    });
    flight = result.flight;
  }
  return finalizeRecordedFlight(flight, flight.points.at(-1).timestamp);
}

test("un vol GPS long devient une entrée Journal légère dont la trace reste récupérable", () => {
  const recorded = longRecordedFlight();
  const journal = recordedFlightToJournalFlight(recorded);
  assert.equal(journal.id, recorded.id);
  assert.equal(journal.origin, "REAL_GPS");
  assert.equal(journal.logbookStatus, "CARNET_PENDING");
  assert.equal(journal.points.length, 0);
  assert.equal(journal.sourceFlightId, recorded.id);
  assert.equal(recordedFlightPointsToJournalPoints(recorded).length, 420);
  assert.ok(journal.distanceKm > 30);
  assert.equal(journal.balloonRegistration, "F-HLFM");
});

test("une récupération sans heure de fin utilise le dernier point et reste idempotente", () => {
  const completed = longRecordedFlight();
  const interrupted = { ...completed, status: "INTERRUPTED", endedAt: null };
  const recovered = recordedFlightToJournalFlight(interrupted, { recovered: true });
  const once = ensureCompletionJournalFlight(createEmptyFlightCompletionState(), recovered);
  const twice = ensureCompletionJournalFlight(once, recovered);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.landingTime, new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(interrupted.points.at(-1).timestamp));
  assert.equal(twice.journalFlights.length, 1);
  assert.equal(twice.officialAscensions.length, 0);
});

test("les vols DEMO sont absents du mode normal et exclus de ses statistiques", () => {
  const real = recordedFlightToJournalFlight(longRecordedFlight());
  const demo = { ...real, id: "demo", origin: "DEMO" };
  const normal = journalFlightsForMode([demo, real], false);
  assert.deepEqual(normal.map(({ id }) => id), [real.id]);
  assert.equal(normal.reduce((sum, flight) => sum + flight.distanceKm, 0), real.distanceKm);
  assert.equal(journalFlightsForMode([demo, real], true).length, 2);
});

test("un ancien stockage de session est converti sans mutation ni suppression", () => {
  const source = {
    version: 1,
    status: "recording",
    startTime: 1_000,
    points: [{ timestamp: 1_000, latitude: 50, longitude: 3, altitude: 100, speed: 2, heading: 90, accuracy: 8, verticalAccuracy: 10 }],
    metrics: { altitude: 100, verticalSpeed: 0, groundSpeed: 2, heading: 90, durationSeconds: 0, distanceKm: 0, lastUpdated: 1_000 },
    savedAt: 2_000,
  };
  const snapshot = structuredClone(source);
  const migrated = legacyFlightSessionToRecordedFlight(source);
  assert.equal(migrated.status, "INTERRUPTED");
  assert.equal(migrated.points.length, 1);
  assert.deepEqual(source, snapshot);
});

test("la feuille de fin ne s’ouvre qu’après stockage du vol et du Journal", () => {
  const tracking = readFileSync(new URL("../hooks/useFlightTracking.ts", import.meta.url), "utf8");
  const flightPage = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  assert.ok(tracking.indexOf("await storageRef.current.completeFlight(completed)") < tracking.indexOf("persistRecordedFlightInJournal(completed)"));
  assert.ok(tracking.indexOf("persistRecordedFlightInJournal(completed)") < tracking.indexOf("return completed"));
  assert.match(flightPage, /if \(completed\)[\s\S]*router\.push\("\/flight\/complete"\)/);
});
