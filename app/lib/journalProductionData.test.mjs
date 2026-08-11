import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sources = [
  "../journal/page.tsx",
  "../journal/[id]/page.tsx",
  "../journal/[id]/graphs/page.tsx",
  "../journal/[id]/statistics/page.tsx",
  "../journal/ascension/[id]/page.tsx",
  "../components/journal/JournalHub.tsx",
  "../components/journal/JournalFlightList.tsx",
  "../components/journal/AscensionLog.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

test("le Journal de production ne charge aucune collection de démonstration", () => {
  assert.doesNotMatch(sources, /JOURNAL_FLIGHTS|ASCENSIONS|getJournalFlight\s*\(|getAscension\s*\(|demoEnabled|sampleFlights|mockFlights|demoFlights/);
  assert.doesNotMatch(sources, /<JournalFlightList\s+flights=|<AscensionLog\s+ascensions=/);
});

test("un scope sans vol affiche l'état vide demandé", () => {
  assert.match(sources, /journalFlightsForMode\(completionState\.journalFlights, false\)/);
  assert.match(sources, /Aucun vol enregistré/);
});

test("les détails sans donnée scoped ne reçoivent aucun fallback initial", () => {
  assert.equal((sources.match(/initialFlight=\{null\}/g) ?? []).length, 3);
  assert.match(sources, /<JournalFlightDetail flightId=\{id\} initialFlight=\{null\}/);
});
