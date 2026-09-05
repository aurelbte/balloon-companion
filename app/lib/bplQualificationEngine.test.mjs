import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarMonths, calculateBplAdditionalClassExperience, calculateBplMaintenance, calculateBplPrivilegesMaintenance, calculateDatedExperience, trainingFlightDueDate } from "./bplQualificationEngine.ts";
import { bplEventCredits } from "./qualificationEventCredits.ts";
import { createQualificationEvent } from "./pilotQualifications.ts";
import { removeQualificationEvent } from "./qualificationEventForm.ts";

const profile = { licenceType: "BPL", commercialOperationsEnabled: false, fiBEnabled: false, feBEnabled: false };
let sequence = 0;

function ascension(id, dateIso, minutes = 60, movements) {
  return { id, sourceFlightId: null, source: "MANUAL", dateIso, date: dateIso, balloonModel: "Z105", registration: "F-TEST", departure: "A", arrival: "B", category: "Libre à air chaud", pilotFunction: "Pilote", regulatoryRole: "PIC", supervisedByFiB: false, nightFlight: false, maximumAltitudeM: null, gpsDurationMinutes: null, officialDurationMinutes: minutes, observations: "", ...(movements ?? {}) };
}

function event(type, dateIso, person = {}) {
  sequence += 1;
  return createQualificationEvent({ type, dateIso, source: "MANUAL", ...person }, { uuid: () => `123e4567-e89b-42d3-a456-${String(sequence).padStart(12, "0")}`, now: () => new Date("2026-08-20T00:00:00Z") });
}

test("la fenêtre 24 mois inclut la frontière et exclut openingBalance", () => {
  const result = calculateBplMaintenance({ profile, events: [], ascensions: [ascension("inside", "2024-08-20", 360, { takeoffCount: 10, landingCount: 10 }), ascension("outside", "2024-08-19", 600)], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true, openingBalance: { confirmed: true, ascensions: 100, officialDurationMinutes: 10_000 } });
  assert.equal(result.datedExperience.officialDurationMinutes, 360);
  assert.equal(result.recentExperience.status, "COMPLIANT");
  assert.equal(result.excludedOpeningBalance.officialDurationMinutes, 10_000);
});

test("une fenêtre BPL partiellement couverte reste UNKNOWN sans proposer FE(B)", () => {
  const result = calculateBplMaintenance({ profile, events: [], ascensions: [ascension("known", "2026-01-01", 60)], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true, historyCoverageStartDate: "2025-01-01" });
  assert.equal(result.recentExperience.status, "UNKNOWN");
  assert.equal(result.overall.status, "UNKNOWN");
  assert.equal(result.proficiencyCheckFeB.status, "NON_APPLICABLE");
  assert.match(result.recentExperience.reason, /Historique récent à compléter/);
});

test("une fenêtre BPL explicitement complète peut conclure ACTION_REQUIRED", () => {
  const result = calculateBplMaintenance({ profile, events: [], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false, historyCoverageStartDate: "2024-08-20" });
  assert.equal(result.recentExperience.status, "ACTION_REQUIRED");
  assert.equal(result.overall.status, "ACTION_REQUIRED");
});

test("une déclaration BPL applicable sert de pont puis est ignorée avec un historique complet", () => {
  const declaredProfile = { ...profile, declaredBplInitialSituation: { referenceDateIso: "2026-08-01", recentExperienceSatisfied: true } };
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { instructor: { name: "FI Test" } });
  const partial = calculateBplMaintenance({ profile: declaredProfile, events: [training], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false, historyCoverageStartDate: "2025-01-01" });
  assert.equal(partial.recentExperience.status, "COMPLIANT");
  assert.equal(partial.recentExperience.provenance, "DECLARED_BY_PILOT");
  assert.equal(partial.recentExperience.currentValue.officialDurationMinutes, 0);
  assert.equal(partial.overall.provenance, "DECLARED_BY_PILOT");
  const complete = calculateBplMaintenance({ profile: declaredProfile, events: [training], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false, historyCoverageStartDate: "2024-08-20" });
  assert.equal(complete.recentExperience.status, "ACTION_REQUIRED");
  assert.equal(complete.recentExperience.provenance, undefined);
});

test("une déclaration BPL périmée ne remplace pas un historique incomplet", () => {
  const declaredProfile = { ...profile, declaredBplInitialSituation: { referenceDateIso: "2024-08-19", recentExperienceSatisfied: true } };
  const result = calculateBplMaintenance({ profile: declaredProfile, events: [], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false });
  assert.equal(result.recentExperience.status, "UNKNOWN");
  assert.equal(result.proficiencyCheckFeB.status, "NON_APPLICABLE");
});

test("le fallback historique compte un mouvement de chaque sorte par ascension", () => {
  const flights = Array.from({ length: 10 }, (_, index) => ascension(`a-${index}`, "2026-01-01", 36));
  const result = calculateDatedExperience(flights, "2026-08-20");
  assert.equal(result.officialDurationMinutes, 360);
  assert.equal(result.takeoffs, 10);
  assert.equal(result.landings, 10);
  assert.equal(result.legacyMovementFallbackAscensionIds.length, 10);
  assert.equal(result.byCategory["Libre à air chaud"].ascensions, 10);
});

test("les compteurs explicites supportent plusieurs mouvements", () => {
  const result = calculateDatedExperience([ascension("multi", "2026-01-01", 360, { takeoffCount: 10, landingCount: 12 })], "2026-08-20");
  assert.deepEqual([result.ascensions, result.takeoffs, result.landings], [1, 10, 12]);
  assert.deepEqual(result.legacyMovementFallbackAscensionIds, []);
});

test("les heures PIC et mouvements suivent exclusivement regulatoryRole", () => {
  const result = calculateDatedExperience([
    ascension("pic", "2026-01-01", 120, { regulatoryRole: "PIC", takeoffCount: 2, landingCount: 2 }),
    ascension("supervised", "2026-01-02", 60, { regulatoryRole: "PIC", supervisedByFiB: true, takeoffCount: 1, landingCount: 1 }),
    ascension("dual", "2026-01-03", 300, { regulatoryRole: "DUAL", pilotFunction: "Élève", takeoffCount: 4, landingCount: 4 }),
    ascension("fi", "2026-01-04", 90, { regulatoryRole: "FI_B", takeoffCount: 8, landingCount: 8 }),
    ascension("fe", "2026-01-05", 90, { regulatoryRole: "FE_B", takeoffCount: 8, landingCount: 8 }),
    ascension("legacy-pilot", "2026-01-06", 600, { regulatoryRole: null, supervisedByFiB: null, takeoffCount: 10, landingCount: 10 }),
  ], "2026-08-20");
  assert.equal(result.officialDurationMinutes, 360);
  assert.equal(result.takeoffs, 7);
  assert.equal(result.landings, 7);
  assert.deepEqual(result.unqualifiedRegulatoryRoleAscensionIds, ["legacy-pilot"]);
});

test("DUAL utilise le fallback mouvements sans ajouter de temps PIC", () => {
  const result = calculateDatedExperience([ascension("dual", "2026-01-01", 360, { regulatoryRole: "DUAL", pilotFunction: "Élève" })], "2026-08-20");
  assert.equal(result.officialDurationMinutes, 0);
  assert.equal(result.takeoffs, 1);
  assert.equal(result.landings, 1);
  assert.deepEqual(result.legacyMovementFallbackAscensionIds, ["dual"]);
});

test("un calcul ciblé ne mélange pas les classes et CAPTIVE reste une nature", () => {
  const hotAir = ascension("hot", "2026-01-01", 360, { category: "Libre à air chaud", flightNature: "CAPTIVE", takeoffCount: 10, landingCount: 10 });
  const gas = ascension("gas", "2026-01-02", 600, { category: "Libre à gaz", takeoffCount: 10, landingCount: 10 });
  const result = calculateDatedExperience([hotAir, gas], "2026-08-20", 24, { classId: "HOT_AIR_BALLOON" });
  assert.equal(result.officialDurationMinutes, 360);
  assert.deepEqual(result.sourceAscensionIds, ["hot"]);
});

test("la voie FI(B) suit exactement 48 mois", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2022-08-20", { instructor: { name: "FI Test" } });
  const flights = [ascension("recent", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 })];
  const boundary = calculateBplMaintenance({ profile, events: [training], ascensions: flights, referenceDateIso: "2026-08-31", ascensionHistoryComplete: true });
  assert.equal(boundary.trainingFlightFiB.dueDate, "2026-08-31");
  assert.equal(boundary.trainingFlightFiB.status, "WARNING");
  assert.equal(boundary.overall.status, "COMPLIANT");
  assert.equal(calculateBplMaintenance({ profile, events: [training], ascensions: flights, referenceDateIso: "2026-09-01", ascensionHistoryComplete: true }).trainingFlightFiB.status, "ACTION_REQUIRED");
});

test("l’échéance training part du dernier jour du mois, y compris en février", () => {
  assert.equal(trainingFlightDueDate("2026-05-10"), "2030-05-31");
  assert.equal(trainingFlightDueDate("2024-02-10"), "2028-02-29");
  assert.equal(trainingFlightDueDate("2023-02-10"), "2027-02-28");
});

test("la voie normale satisfaite ne rend pas le contrôle FE(B) obligatoire", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { instructor: { name: "FI Test" } });
  const flights = [ascension("recent", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 })];
  const result = calculateBplMaintenance({ profile, events: [training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.overall.status, "COMPLIANT");
  assert.equal(result.proficiencyCheckFeB.status, "NON_APPLICABLE");
  assert.match(result.proficiencyCheckFeB.reason, /alternative non nécessaire/);
});

test("la délivrance initiale ne fournit aucun crédit training", () => {
  const issuance = event("INITIAL_BPL_ISSUANCE", "2023-04-30");
  const flights = [ascension("recent", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 })];
  const initial = calculateBplMaintenance({ profile, events: [issuance], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(initial.trainingFlightFiB.status, "UNKNOWN");
  const training = event("TRAINING_FLIGHT_BPL", "2025-06-01", { instructor: { name: "FI Test" } });
  const updated = calculateBplMaintenance({ profile, events: [issuance, training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(updated.trainingFlightFiB.currentValue, "2025-06-01");
  assert.deepEqual(updated.trainingFlightFiB.sourceEventIds, [training.id]);
});

test("SKILL_TEST reste sans crédit et les événements liés supprimés sont inactifs", () => {
  const skill = event("SKILL_TEST_BPL", "2026-01-01", { examiner: { name: "FE Test" } });
  const deletedTraining = event("TRAINING_FLIGHT_BPL", "2026-01-02", { instructor: { name: "FI Test" }, officialAscensionId: "asc-1", officialAscensionDeletedAt: "2026-02-01T00:00:00.000Z" });
  const deletedCheck = event("COMMERCIAL_PROFICIENCY_CHECK", "2026-01-03", { examiner: { name: "FE Test" }, balloonClass: { classId: "HOT_AIR_BALLOON" }, officialAscensionId: "asc-2", officialAscensionDeletedAt: "2026-02-01T00:00:00.000Z" });
  assert.deepEqual(bplEventCredits([skill, deletedTraining, deletedCheck]), []);
});

test("le legacy rend l’insuffisance incertaine mais ne bloque pas des preuves explicites suffisantes", () => {
  const legacy = ascension("legacy", "2026-01-01", 600, { regulatoryRole: null, supervisedByFiB: null, takeoffCount: 10, landingCount: 10 });
  const unknown = calculateBplMaintenance({ profile, events: [], ascensions: [legacy], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(unknown.recentExperience.status, "UNKNOWN");
  const explicit = ascension("explicit", "2026-01-02", 360, { takeoffCount: 10, landingCount: 10 });
  const compliant = calculateBplMaintenance({ profile, events: [], ascensions: [legacy, explicit], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(compliant.recentExperience.status, "COMPLIANT");
  const immaterial = calculateBplMaintenance({ profile, events: [], ascensions: [ascension("small-legacy", "2026-01-03", 1, { regulatoryRole: null, supervisedByFiB: null, takeoffCount: 0, landingCount: 0 })], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(immaterial.recentExperience.status, "ACTION_REQUIRED");
});

test("la voie FE(B) alternative suit exactement 24 mois", () => {
  const check = event("PROFICIENCY_CHECK_BPL", "2024-08-20", { examiner: { name: "FE Test" } });
  const boundary = calculateBplMaintenance({ profile, events: [check], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(boundary.proficiencyCheckFeB.status, "WARNING");
  assert.equal(boundary.overall.status, "COMPLIANT");
  assert.equal(calculateBplMaintenance({ profile, events: [check], ascensions: [], referenceDateIso: "2026-08-21", ascensionHistoryComplete: true }).overall.status, "ACTION_REQUIRED");
});

test("les crédits événementiels respectent la classe cible", () => {
  const check = event("COMMERCIAL_PROFICIENCY_CHECK", "2026-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON" }, examiner: { name: "FE Test" } });
  const hot = calculateBplMaintenance({ profile, events: [check], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true, balloonClass: { classId: "HOT_AIR_BALLOON" } });
  const gas = calculateBplMaintenance({ profile, events: [check], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true, balloonClass: { classId: "GAS_BALLOON" } });
  assert.equal(hot.proficiencyCheckFeB.status, "COMPLIANT");
  assert.equal(gas.proficiencyCheckFeB.status, "UNKNOWN");
});

test("supprimer le contrôle alternatif recalcule le moteur sans toucher aux ascensions", () => {
  const check = event("PROFICIENCY_CHECK_BPL", "2026-01-01", { examiner: { name: "FE Test" } });
  const ascensions = [ascension("source", "2023-01-01", 60)];
  const before = structuredClone(ascensions);
  assert.equal(calculateBplMaintenance({ profile, events: [check], ascensions, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true }).overall.status, "COMPLIANT");
  const events = removeQualificationEvent([check], check.id);
  assert.equal(events.length, 0);
  assert.equal(calculateBplMaintenance({ profile, events, ascensions, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true }).overall.status, "ACTION_REQUIRED");
  assert.deepEqual(ascensions, before);
});

test("un événement sans FI/FE et les données incomplètes restent UNKNOWN", () => {
  const result = calculateBplMaintenance({ profile, events: [event("TRAINING_FLIGHT_BPL", "2026-01-01")], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: false });
  assert.equal(result.recentExperience.status, "UNKNOWN");
  assert.equal(result.trainingFlightFiB.status, "UNKNOWN");
  assert.equal(result.overall.status, "UNKNOWN");
});

test("LEGACY_FLIGHT_TEST_DUE_DATE ne satisfait aucune voie BPL", () => {
  const legacy = event("LEGACY_FLIGHT_TEST_DUE_DATE", "2027-01-01");
  const result = calculateBplMaintenance({ profile, events: [legacy], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.trainingFlightFiB.status, "UNKNOWN");
  assert.equal(result.proficiencyCheckFeB.status, "UNKNOWN");
  assert.equal(result.overall.status, "ACTION_REQUIRED");
});

test("les mois calendaires conservent correctement les fins de mois", () => {
  assert.equal(addCalendarMonths("2024-02-29", 24), "2026-02-28");
  assert.equal(addCalendarMonths("2026-08-31", -24), "2024-08-31");
});

test("sans classe BPL déclarée le résultat demande une configuration", () => {
  const result = calculateBplPrivilegesMaintenance({ profile: { ...profile, bplBalloonClasses: [] }, events: [], ascensions: [], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.overall.status, "UNKNOWN");
  assert.equal(result.referenceClass, null);
});

test("une seule classe applique BFCL.160(a) à cette classe", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON" }, instructor: { name: "FI" } });
  const flights = [ascension("hot", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 })];
  const result = calculateBplPrivilegesMaintenance({ profile: { ...profile, bplBalloonClasses: ["HOT_AIR_BALLOON"] }, events: [training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.overall.status, "COMPLIANT");
  assert.equal(result.classResults[0].requirement, "BFCL_160_A");
});

test("la classe gaz seule applique BFCL.160(a) sans mélanger l'air chaud", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "GAS_BALLOON" }, instructor: { name: "FI" } });
  const flights = [ascension("gas", "2026-01-01", 360, { category: "Libre à gaz", takeoffCount: 10, landingCount: 10 }), ascension("hot", "2026-01-02", 600, { takeoffCount: 10, landingCount: 10 })];
  const result = calculateBplPrivilegesMaintenance({ profile: { ...profile, bplBalloonClasses: ["GAS_BALLOON"] }, events: [training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.overall.status, "COMPLIANT");
  assert.equal(result.referenceRequirement.datedExperience.officialDurationMinutes, 360);
});

test("deux classes choisissent la combinaison conforme et appliquent 180 minutes à l'autre classe", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON" }, instructor: { name: "FI" } });
  const flights = [
    ascension("hot", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 }),
    ascension("gas", "2026-01-02", 180, { category: "Libre à gaz", regulatoryRole: "DUAL", takeoffCount: 0, landingCount: 0 }),
  ];
  const result = calculateBplPrivilegesMaintenance({ profile: { ...profile, bplBalloonClasses: ["HOT_AIR_BALLOON", "GAS_BALLOON"] }, events: [training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.overall.status, "COMPLIANT");
  assert.equal(result.referenceClass.classId, "HOT_AIR_BALLOON");
  assert.deepEqual(result.classResults.map(({ requirement }) => requirement), ["BFCL_160_A", "BFCL_160_B"]);
});

test("le moteur peut choisir gaz comme classe de référence sans la persister", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "GAS_BALLOON" }, instructor: { name: "FI" } });
  const flights = [ascension("gas", "2026-01-01", 360, { category: "Libre à gaz", takeoffCount: 10, landingCount: 10 }), ascension("hot", "2026-01-02", 180)];
  const declared = { ...profile, bplBalloonClasses: ["HOT_AIR_BALLOON", "GAS_BALLOON"] };
  const result = calculateBplPrivilegesMaintenance({ profile: declared, events: [training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.referenceClass.classId, "GAS_BALLOON");
  assert.equal(result.overall.status, "COMPLIANT");
  assert.equal("referenceClass" in declared, false);
});

test("une classe supplémentaire sous 180 minutes rend la combinaison insuffisante", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON" }, instructor: { name: "FI" } });
  const flights = [ascension("hot", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 }), ascension("gas", "2026-01-02", 179, { category: "Libre à gaz" })];
  const result = calculateBplPrivilegesMaintenance({ profile: { ...profile, bplBalloonClasses: ["HOT_AIR_BALLOON", "GAS_BALLOON"] }, events: [training], ascensions: flights, referenceDateIso: "2026-08-20", ascensionHistoryComplete: true });
  assert.equal(result.overall.status, "ACTION_REQUIRED");
});

test("BFCL.160(b) compte PIC, PIC supervisé, DUAL, FI(B) et FE(B)", () => {
  const roles = ["PIC", "PIC", "DUAL", "FI_B", "FE_B"];
  const flights = roles.map((regulatoryRole, index) => ascension(`role-${index}`, "2026-01-01", 36, { category: "Libre à gaz", regulatoryRole, supervisedByFiB: index === 1 }));
  const result = calculateBplAdditionalClassExperience({ ascensions: flights, referenceDateIso: "2026-08-20", balloonClass: { classId: "GAS_BALLOON" }, historyComplete: true });
  assert.equal(result.explicitMinutes, 180);
  assert.equal(result.status, "COMPLIANT");
});

test("le legacy null ne rend UNKNOWN que s'il peut combler le seuil de 180 minutes", () => {
  const base = [ascension("known", "2026-01-01", 120, { category: "Libre à gaz" })];
  const possible = calculateBplAdditionalClassExperience({ ascensions: [...base, ascension("legacy", "2026-01-02", 60, { category: "Libre à gaz", regulatoryRole: null })], referenceDateIso: "2026-08-20", balloonClass: { classId: "GAS_BALLOON" }, historyComplete: true });
  const impossible = calculateBplAdditionalClassExperience({ ascensions: [...base, ascension("legacy-small", "2026-01-02", 59, { category: "Libre à gaz", regulatoryRole: null })], referenceDateIso: "2026-08-20", balloonClass: { classId: "GAS_BALLOON" }, historyComplete: true });
  assert.equal(possible.status, "UNKNOWN");
  assert.equal(impossible.status, "ACTION_REQUIRED");
});

function maintainedHotAir(events, privilege = "D", referenceDateIso = "2026-08-20") {
  return calculateBplPrivilegesMaintenance({
    profile: { ...profile, bplBalloonClasses: ["HOT_AIR_BALLOON"], hotAirBalloonGroupPrivilege: privilege },
    events,
    ascensions: [ascension("hot-maintained", "2026-01-01", 360, { takeoffCount: 10, landingCount: 10 })],
    referenceDateIso,
    ascensionHistoryComplete: true,
  }).referenceRequirement;
}

test("BFCL.160(d) limite au minimum entre privilège pilote et groupe du crédit", () => {
  const trainingD = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "D" }, instructor: { name: "FI" } });
  const trainingB = event("TRAINING_FLIGHT_BPL", "2026-01-02", { balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "B" }, instructor: { name: "FI" } });
  assert.equal(maintainedHotAir([trainingD], "D").groupLimitation.exercisableGroup, "D");
  assert.equal(maintainedHotAir([trainingB], "D").groupLimitation.exercisableGroup, "B");
  assert.equal(maintainedHotAir([trainingD], "C").groupLimitation.exercisableGroup, "C");
  assert.equal(maintainedHotAir([trainingD], "B").groupLimitation.exercisableGroup, "B");
});

test("le meilleur crédit valide est retenu même s'il est plus ancien", () => {
  const checkD = event("PROFICIENCY_CHECK_BPL", "2025-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "D" }, examiner: { name: "FE" } });
  const trainingB = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "B" }, instructor: { name: "FI" } });
  const result = maintainedHotAir([checkD, trainingB], "D");
  assert.equal(result.groupLimitation.exercisableGroup, "D");
  assert.deepEqual(result.groupLimitation.sourceEventIds, [checkD.id]);
});

test("un crédit groupe D expiré n'est pas retenu face à un crédit B valide", () => {
  const expiredD = event("PROFICIENCY_CHECK_BPL", "2024-08-19", { balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "D" }, examiner: { name: "FE" } });
  const validB = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "B" }, instructor: { name: "FI" } });
  assert.equal(maintainedHotAir([expiredD, validB], "D").groupLimitation.exercisableGroup, "B");
});

test("un groupe manquant reste UNKNOWN sans invalider le maintien BPL", () => {
  const unknownGroup = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "HOT_AIR_BALLOON" }, instructor: { name: "FI" } });
  const result = maintainedHotAir([unknownGroup], null);
  assert.equal(result.overall.status, "COMPLIANT");
  assert.equal(result.groupLimitation.status, "UNKNOWN");
});

test("les groupes hot-air sont non applicables à la classe gaz", () => {
  const training = event("TRAINING_FLIGHT_BPL", "2026-01-01", { balloonClass: { classId: "GAS_BALLOON" }, instructor: { name: "FI" } });
  const result = calculateBplMaintenance({ profile, events: [training], ascensions: [ascension("gas", "2026-01-01", 360, { category: "Libre à gaz", takeoffCount: 10, landingCount: 10 })], referenceDateIso: "2026-08-20", ascensionHistoryComplete: true, balloonClass: { classId: "GAS_BALLOON" } });
  assert.equal(result.groupLimitation.status, "NON_APPLICABLE");
});
