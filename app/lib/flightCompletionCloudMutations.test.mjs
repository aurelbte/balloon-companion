import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { journalFlightCloudMutations } from "./flightCompletionStorage.ts";
import { createEmptyFlightCompletionState, ensureCompletionJournalFlight } from "./flightCompletion.ts";

function journalFlight(input = {}) {
  const initial = ensureCompletionJournalFlight(createEmptyFlightCompletionState()).journalFlights[0];
  return { ...initial, ...input };
}

test("le diff Cloud du Journal cible sourceFlightId et ignore les points GPS", () => {
  const previous = [journalFlight({ id: "journal-1", sourceFlightId: "flight-1", points: [{ longitude: 3, latitude: 50, elapsedMinutes: 0, altitudeM: 100, speedKmh: 10 }] })];
  const sameWithoutTrace = [{ ...previous[0], points: [{ longitude: 4, latitude: 51, elapsedMinutes: 1, altitudeM: 110, speedKmh: 12 }] }];
  const modified = [{ ...sameWithoutTrace[0], customTitle: "Vol du soir" }];

  assert.deepEqual(journalFlightCloudMutations(previous, sameWithoutTrace), []);
  assert.deepEqual(journalFlightCloudMutations(previous, modified), [{ entityId: "flight-1", operation: "UPSERT" }]);
});

test("le diff Cloud du Journal produit UPSERT à l'ajout et DELETE à la suppression", () => {
  const flight = journalFlight({ id: "journal-2", sourceFlightId: undefined });

  assert.deepEqual(journalFlightCloudMutations([], [flight]), [{ entityId: "journal-2", operation: "UPSERT" }]);
  assert.deepEqual(journalFlightCloudMutations([flight], []), [{ entityId: "journal-2", operation: "DELETE" }]);
});

test("un changement hors journalFlights ne crée aucune mutation flight", () => {
  const flight = journalFlight({ id: "journal-3", sourceFlightId: "flight-3" });
  assert.deepEqual(journalFlightCloudMutations([flight], [structuredClone(flight)]), []);
});

test("la sauvegarde conserve le singleton et enfile les mutations flight calculées", () => {
  const source = readFileSync(new URL("./flightCompletionStorage.ts", import.meta.url), "utf8");
  assert.match(source, /enqueueLocalSyncMutation\("flight-completion", "singleton"\)/);
  assert.match(source, /journalFlightCloudMutations\(previousState\.journalFlights, lightweightState\.journalFlights\)/);
  assert.match(source, /enqueueLocalSyncMutation\("flight", mutation\.entityId, mutation\.operation\)/);
});
