import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createEmptyFlightCompletionState, ensureCompletionJournalFlight, setJournalFlightNotes } from "./flightCompletion.ts";

const journalFlight = {
  id: "note-flight", departure: "A", arrival: "B", date: "17 août 2026", dateIso: "2026-08-17", balloonRegistration: "F-TEST",
  durationMinutes: 60, distanceKm: 10, takeoffTime: "07:00", landingTime: "08:00", maxAltitudeM: 500, maxSpeedKmh: 20,
  notes: null, statistics: {}, points: [], logbookStatus: "CARNET_PENDING", origin: "REAL_GPS",
};

test("la projection JournalFlight suit ajout, modification et suppression", () => {
  const initial = ensureCompletionJournalFlight(createEmptyFlightCompletionState(), journalFlight);
  const added = setJournalFlightNotes(initial, journalFlight.id, "Premier récit");
  assert.equal(added.journalFlights[0].notes, "Premier récit");
  const modified = setJournalFlightNotes(added, journalFlight.id, "Récit corrigé");
  assert.equal(modified.journalFlights[0].notes, "Récit corrigé");
  const removed = setJournalFlightNotes(modified, journalFlight.id, null);
  assert.equal(removed.journalFlights[0].notes, null);
});

test("l'éditeur Notes est local, multiligne et utilisable avec le clavier mobile", () => {
  const dialog = readFileSync(new URL("../components/journal/FlightNoteDialog.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../components/journal/JournalFlightDetail.tsx", import.meta.url), "utf8");
  assert.match(dialog, /<textarea/);
  assert.match(dialog, /safe-area-inset-bottom/);
  assert.match(dialog, /Annuler/);
  assert.match(dialog, /Enregistrer/);
  assert.doesNotMatch(dialog, /fetch\(|WebSocket|axios/);
  assert.match(detail, /updateFlightNotes/);
  assert.match(detail, /persistJournalFlightNotes/);
  assert.match(detail, /Ajouter une note/);
  assert.match(detail, /Modifier/);
});

test("toute la carte Notes ouvre l'éditeur au toucher et au clavier sans bouton imbriqué", () => {
  const detail = readFileSync(new URL("../components/journal/JournalFlightDetail.tsx", import.meta.url), "utf8");
  const noteCard = detail.match(/<article className=\{`\$\{styles\.moduleCard\} \$\{styles\.moduleLink\}`\} role="button"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(noteCard, /tabIndex=\{0\}/);
  assert.match(noteCard, /aria-label=\{displayedNote \? "Modifier la note de vol" : "Ajouter une note de vol"\}/);
  assert.match(noteCard, /onClick=\{\(\) => setNoteEditorOpen\(true\)\}/);
  assert.match(noteCard, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(detail, /initialNote=\{displayedNote \?\? ""\}/);
  assert.doesNotMatch(noteCard, /<button/);
});
