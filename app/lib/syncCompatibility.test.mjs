import test from "node:test";
import assert from "node:assert/strict";

import { createBalloon } from "./balloons.ts";
import { migrateBalloonRegistry } from "./balloonStorage.ts";
import { normalizePilotProfile } from "./pilotProfile.ts";
import { createRecordedFlight } from "./recordedFlight.ts";
import { normalizeUnitPreferences } from "./unitPreferencesStorage.ts";

test("les IDs des anciennes entités restent strictement inchangés", () => {
  const legacy = migrateBalloonRegistry({
    version: 4,
    activeBalloonId: "F-OLD",
    balloons: [{ id: "F-OLD", registration: "F-OLD", manufacturer: "Cameron", model: "Z105", category: "Libre à air chaud", volumeM3: 2973, documents: [], weights: { fullCylinders: [] } }],
  });
  assert.equal(legacy.balloons[0].id, "F-OLD");
  assert.equal(legacy.activeBalloonId, "F-OLD");
  assert.equal(createRecordedFlight({ id: "legacy-flight", startedAt: 1 }).id, "legacy-flight");
});

test("un nouveau ballon reçoit un ID interne stable distinct de l'immatriculation", () => {
  const balloon = createBalloon({ registration: "F-TEST", manufacturer: "Cameron", model: "Z105", category: "Libre à air chaud", volumeM3: 2973, weights: { fullCylinders: [] } });
  assert.notEqual(balloon.id, balloon.registration);
  assert.equal(createBalloon({ registration: "F-NEWX", manufacturer: "Cameron", model: "Z105", category: "Libre à air chaud", volumeM3: 2973, weights: { fullCylinders: [] } }, balloon.id).id, balloon.id);
});

test("anciens profil et préférences restent normalisables sans champ sync embarqué", () => {
  const profile = normalizePilotProfile({ version: 1, firstName: "Ada", lastName: "Lovelace", licenseNumber: "abc", usualFunction: "Pilote", flightTestDueDateIso: "", medicalDueDateIso: "" });
  assert.equal(profile.firstName, "Ada");
  assert.equal("revision" in profile, false);
  assert.equal(normalizeUnitPreferences(null).flightInstruments.altitudeUnit, "m");
});
