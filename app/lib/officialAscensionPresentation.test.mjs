import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultOfficialAscensionInput } from "./flightCompletion.ts";
import {
  officialAscensionFlightNatureLabel,
  officialAscensionMovementLabels,
  officialAscensionOriginLabel,
  officialAscensionRegulatoryRoleLabel,
  qualificationPersonLabel,
} from "./officialAscensionPresentation.ts";

function ascension(overrides = {}) {
  return {
    ...defaultOfficialAscensionInput(),
    id: "ascension-test",
    sourceFlightId: "flight-test",
    source: "GPS_BALLOON_COMPANION",
    gpsDurationMinutes: 57,
    ...overrides,
  };
}

test("présente fidèlement les origines GPS et manuelle", () => {
  assert.equal(officialAscensionOriginLabel("GPS_BALLOON_COMPANION"), "GPS · Balloon Companion");
  assert.equal(officialAscensionOriginLabel("MANUAL"), "Saisie manuelle");
});

test("présente la nature et les mouvements normalisés", () => {
  assert.equal(officialAscensionFlightNatureLabel(ascension({ flightNature: "TRAINING_BPL" })), "Vol d’entraînement BPL");
  assert.equal(officialAscensionFlightNatureLabel(ascension({ flightNature: "CAPTIVE" })), "Vol captif");
  assert.deepEqual(officialAscensionMovementLabels(ascension({ takeoffCount: 2, landingCount: 3 })), { takeoffs: "2", landings: "3" });
  assert.deepEqual(officialAscensionMovementLabels(ascension({ takeoffCount: undefined, landingCount: undefined })), { takeoffs: "1", landings: "1" });
});

test("omet les personnes absentes et affiche les personnes présentes sans ligne vide", () => {
  assert.equal(qualificationPersonLabel(undefined), null);
  assert.equal(qualificationPersonLabel({ name: "   " }), null);
  assert.equal(qualificationPersonLabel({ name: "Anne Martin" }), "Anne Martin");
  assert.equal(qualificationPersonLabel({ name: "Anne Martin", licenceNumber: "FI-123" }), "Anne Martin · FI-123");
});

test("présente les rôles réglementaires sans réinterpréter les lignes legacy", () => {
  assert.equal(officialAscensionRegulatoryRoleLabel(ascension({ regulatoryRole: "PIC" })), "Commandant de bord (PIC)");
  assert.equal(officialAscensionRegulatoryRoleLabel(ascension({ regulatoryRole: "DUAL" })), "Double commande");
  assert.equal(officialAscensionRegulatoryRoleLabel(ascension({ regulatoryRole: "FI_B" })), "Instructeur FI(B)");
  assert.equal(officialAscensionRegulatoryRoleLabel(ascension({ regulatoryRole: "FE_B" })), "Examinateur FE(B)");
  assert.equal(officialAscensionRegulatoryRoleLabel(ascension({ regulatoryRole: null, pilotFunction: "Élève" })), "Élève");
});

test("la fiche conserve ses informations existantes et ajoute les champs réglementaires conditionnels", () => {
  const source = readFileSync(new URL("../components/journal/CompletionAscensionDetail.tsx", import.meta.url), "utf8");
  for (const label of ["Date", "Type de ballon", "Constructeur", "Immatriculation", "Lieu d’envol", "Lieu d’atterrissage", "Fonction", "Vol de nuit", "Altitude atteinte", "Temps officiel", "Nature du vol", "Décollages", "Atterrissages", "Origine"]) {
    assert.match(source, new RegExp(`\\["${label}"`));
  }
  assert.match(source, /"Solo sous supervision FI\(B\)"/);
  assert.match(source, /"FI\(B\) superviseur" : "Instructeur"/);
  assert.match(source, /\.\.\.\(examiner \? \[\["Examinateur"/);
});
