import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adjacentAirspaceIndex, uniqueSelectedAirspaces } from "./airspaceSelectionNavigation.ts";
import { qnhHpaFromMetar } from "../weather/aviationPresentation.ts";

test("un espace unique reste sélectionnable et les doublons superposés sont supprimés", () => {
  const ctr = { airspaceId: "ctr", name: "CTR", type: 4 };
  const tra = { airspaceId: "tra", name: "TRA", type: 1 };
  assert.deepEqual(uniqueSelectedAirspaces([ctr]), [ctr]);
  assert.deepEqual(uniqueSelectedAirspaces([tra, ctr, tra]), [tra, ctr]);
});

test("précédent et suivant parcourent cycliquement tous les espaces", () => {
  assert.equal(adjacentAirspaceIndex(0, 7, 1), 1);
  assert.equal(adjacentAirspaceIndex(6, 7, 1), 0);
  assert.equal(adjacentAirspaceIndex(0, 7, -1), 6);
});

test("le QNH est extrait du METAR sans fallback standard", () => {
  assert.equal(qnhHpaFromMetar("LFQO 131000Z 04003KT CAVOK 20/10 Q1021"), 1021);
  assert.equal(qnhHpaFromMetar("LFQO 131000Z 04003KT CAVOK 20/10 Q0998"), 998);
  assert.equal(qnhHpaFromMetar("LFQO 131000Z 04003KT CAVOK 20/10"), null);
  assert.equal(qnhHpaFromMetar(null), null);
});

test("le mode Vol utilise les préférences Aviation scopées et affiche l'indisponibilité", () => {
  const page = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const instruments = readFileSync(new URL("../components/flight/FlightInstruments.tsx", import.meta.url), "utf8");
  const core = readFileSync(new URL("./flightCore/createFlightSession.ts", import.meta.url), "utf8");
  assert.match(page, /loadAviationPreferences\(\)\?\.airportIcao/);
  assert.match(instruments, /qnhHpa === null \? "—"/);
  assert.doesNotMatch(core, /qnhHpa: 1013/);
});
