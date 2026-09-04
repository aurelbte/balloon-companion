import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addManualOfficialAscension,
  adjustOfficialDurationMinutes,
  calculatePilotOfficialTotals,
  confirmPilotExperience,
  createEmptyFlightCompletionState,
  createUnconfiguredFlightCompletionState,
  defaultOfficialAscensionInput,
  DEMO_COMPLETION_FLIGHT_ID,
  ensureCompletionJournalFlight,
  removeOfficialAscension,
  removeJournalFlight,
  roundJournalAltitudeMeters,
  setJournalFlightLogbookStatus,
  updateOfficialAscension,
  validateOfficialAscension,
  OFFICIAL_FLIGHT_NATURES,
} from "./flightCompletion.ts";
import { officialAscensionToEditValues } from "./officialAscensionEditing.ts";
import { getAscensionAutomaticName } from "./ascensionMockData.ts";

const manualInput = {
  ...defaultOfficialAscensionInput(),
  dateIso: "2026-08-02",
  date: "2 août 2026",
  officialDurationMinutes: 45,
};

test("nouveau pilote : zéro confirmé reste distinct d’une expérience inconnue", () => {
  const configured = confirmPilotExperience(createUnconfiguredFlightCompletionState(), {
    hours: 0, minutes: 0, ascensions: 0,
  });
  assert.equal(configured.openingBalance.confirmed, true);
  assert.equal(calculatePilotOfficialTotals(configured).officialDurationMinutes, 0);
  const withManual = addManualOfficialAscension(configured, "manual-zero", manualInput);
  assert.equal(calculatePilotOfficialTotals(withManual).officialDurationMinutes, 45);
  assert.equal(calculatePilotOfficialTotals(withManual).ascensions, 1);
});

test("une expérience inconnue produit des totaux neutres", () => {
  const totals = calculatePilotOfficialTotals(createUnconfiguredFlightCompletionState());
  assert.equal(totals.displayHours, null);
  assert.equal(totals.ascensions, null);
});

test("ajout manuel : aucune trace ni entrée Journal n’est inventée", () => {
  const state = addManualOfficialAscension(
    createEmptyFlightCompletionState(), "manual-one", { ...manualInput, officialDurationMinutes: 60 },
  );
  assert.equal(state.journalFlights.length, 0);
  assert.equal(state.officialAscensions[0].source, "MANUAL");
  assert.equal(state.officialAscensions[0].sourceFlightId, null);
  assert.equal(state.officialAscensions[0].gpsDurationMinutes, null);
  assert.equal(calculatePilotOfficialTotals(state).officialDurationMinutes, 8_255);
});

test("un vol captif manuel est une nature valide, sans GPS, et compte intégralement dans les totaux", () => {
  assert.deepEqual(OFFICIAL_FLIGHT_NATURES, [
    "STANDARD", "CAPTIVE", "TRAINING_BPL", "PROFICIENCY_CHECK_BPL", "SKILL_TEST",
    "COMMERCIAL_TRAINING", "COMMERCIAL_PROFICIENCY_CHECK", "INSTRUCTION",
  ]);
  const state = addManualOfficialAscension(
    createEmptyFlightCompletionState(),
    "manual-captive",
    { ...manualInput, flightNature: "CAPTIVE", departure: "Bondues", arrival: "Bondues", officialDurationMinutes: 180, takeoffCount: 2, landingCount: 2 },
  );
  const captive = state.officialAscensions[0];
  assert.equal(captive.flightNature, "CAPTIVE");
  assert.equal(captive.sourceFlightId, null);
  assert.equal(captive.gpsDurationMinutes, null);
  assert.equal(state.journalFlights.length, 0);
  assert.equal(calculatePilotOfficialTotals(state).officialDurationMinutes, 8_195 + 180);
  assert.equal(calculatePilotOfficialTotals(state).ascensions, 109);
  assert.equal(captive.takeoffCount, 2);
  assert.equal(captive.landingCount, 2);
});

test("modifier le solde initial conserve les ascensions manuelles et recalcule le total", () => {
  const withManual = addManualOfficialAscension(
    createEmptyFlightCompletionState(), "manual-kept", { ...manualInput, officialDurationMinutes: 60 },
  );
  const manualBefore = structuredClone(withManual.officialAscensions[0]);
  const modified = confirmPilotExperience(withManual, {
    hours: 140, minutes: 0, ascensions: 110,
  });
  assert.deepEqual(modified.officialAscensions[0], manualBefore);
  assert.equal(calculatePilotOfficialTotals(modified).officialDurationMinutes, 8_460);
  assert.equal(calculatePilotOfficialTotals(modified).ascensions, 111);
});

test("les valeurs invalides ne modifient pas l’expérience antérieure", () => {
  const unknown = createUnconfiguredFlightCompletionState();
  assert.equal(confirmPilotExperience(unknown, { hours: 1, minutes: 60, ascensions: 1 }), unknown);
  assert.equal(confirmPilotExperience(unknown, { hours: -1, minutes: 0, ascensions: 1 }), unknown);
});

test("Journal automatique : la création est idempotente", () => {
  const once = ensureCompletionJournalFlight(createEmptyFlightCompletionState());
  const twice = ensureCompletionJournalFlight(once);
  assert.equal(once.journalFlights.length, 1);
  assert.equal(twice.journalFlights.length, 1);
  assert.equal(twice.journalFlights[0].id, DEMO_COMPLETION_FLIGHT_ID);
});

test("Plus tard : conserve le Journal en attente sans modifier le total officiel", () => {
  const state = ensureCompletionJournalFlight(createEmptyFlightCompletionState());
  assert.equal(state.journalFlights[0].logbookStatus, "CARNET_PENDING");
  assert.equal(state.officialAscensions.length, 0);
  assert.deepEqual(calculatePilotOfficialTotals(state), {
    ascensions: 108,
    officialDurationMinutes: 8_195,
    totalHoursExact: 8_195 / 60,
    displayHours: 136,
    remainingMinutes: 35,
  });
});

test("Validation à 57 minutes : produit exactement 109 ascensions et 137 h 32", () => {
  const state = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    defaultOfficialAscensionInput(),
  );
  const totals = calculatePilotOfficialTotals(state);
  assert.equal(totals.ascensions, 109);
  assert.equal(totals.displayHours, 137);
  assert.equal(totals.remainingMinutes, 32);
});

test("Validation à 60 minutes : ne modifie jamais les 57 minutes GPS", () => {
  const state = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 60 },
  );
  assert.equal(state.journalFlights[0].durationMinutes, 57);
  assert.equal(state.officialAscensions[0].officialDurationMinutes, 60);
  assert.equal(calculatePilotOfficialTotals(state).officialDurationMinutes, 8_255);
});

test("une double validation met à jour l’ascension sans créer de doublon", () => {
  const first = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    defaultOfficialAscensionInput(),
  );
  const second = validateOfficialAscension(
    first,
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 60 },
  );
  assert.equal(second.officialAscensions.length, 1);
});

test("modifier la durée officielle recalcule toujours le total", () => {
  const initial = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 60 },
  );
  const modified = validateOfficialAscension(
    initial,
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 50 },
  );
  assert.equal(calculatePilotOfficialTotals(modified).officialDurationMinutes, 8_245);
});

test("supprimer une ascension recalcule le total et remet le Journal en attente", () => {
  const validated = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 60 },
  );
  const removed = removeOfficialAscension(validated, validated.officialAscensions[0].id);
  assert.equal(calculatePilotOfficialTotals(removed).ascensions, 108);
  assert.equal(removed.journalFlights[0].logbookStatus, "CARNET_PENDING");
});

test("modifier une ascension préserve le vol GPS, sa trace et ses métadonnées mesurées", () => {
  const validated = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 69 },
  );
  const journalBefore = structuredClone(validated.journalFlights[0]);
  const ascensionBefore = validated.officialAscensions[0];
  const modified = updateOfficialAscension(validated, ascensionBefore.id, {
    ...defaultOfficialAscensionInput(),
    balloonModel: "Z105",
    departure: "Bondues",
    arrival: "Templeuve",
    pilotFunction: "Élève",
    officialDurationMinutes: 70,
  });

  assert.deepEqual(modified.journalFlights[0], journalBefore);
  assert.equal(modified.officialAscensions[0].id, ascensionBefore.id);
  assert.equal(modified.officialAscensions[0].sourceFlightId, ascensionBefore.sourceFlightId);
  assert.equal(modified.officialAscensions[0].gpsDurationMinutes, 57);
  assert.equal(modified.officialAscensions[0].departure, "Bondues");
  assert.equal(modified.officialAscensions[0].balloonModel, "Z105");
  assert.equal(modified.officialAscensions[0].pilotFunction, "Élève");
  assert.equal(calculatePilotOfficialTotals(modified).officialDurationMinutes, 8_265);
  assert.equal(calculatePilotOfficialTotals(modified).totalHoursExact, 8_265 / 60);
});

test("la durée seule déclenche l’update et normalise l’altitude métier", () => {
  const originalInput = {
    ...defaultOfficialAscensionInput(),
    officialDurationMinutes: 69,
    maximumAltitudeM: 550.0596481952816,
  };
  const initial = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    originalInput,
  );
  const ascension = initial.officialAscensions[0];

  const unchanged = updateOfficialAscension(initial, ascension.id, originalInput);
  const modified = updateOfficialAscension(initial, ascension.id, {
    ...originalInput,
    officialDurationMinutes: 70,
  });

  assert.equal(unchanged, initial);
  assert.notEqual(modified, initial);
  assert.equal(modified.officialAscensions.length, 1);
  assert.equal(modified.officialAscensions[0].id, ascension.id);
  assert.equal(modified.officialAscensions[0].officialDurationMinutes, 70);
  assert.equal(modified.officialAscensions[0].maximumAltitudeM, 550);
});

test("les altitudes Journal/Carnet utilisent un arrondi entier cohérent", () => {
  assert.equal(roundJournalAltitudeMeters(140.8153415846565), 141);
  assert.equal(roundJournalAltitudeMeters(140.2), 140);
  assert.equal(roundJournalAltitudeMeters(140), 140);
  assert.equal(roundJournalAltitudeMeters(null), null);
  const legacy = { ...validateOfficialAscension(createEmptyFlightCompletionState(), DEMO_COMPLETION_FLIGHT_ID, defaultOfficialAscensionInput()).officialAscensions[0], maximumAltitudeM: 140.8153415846565 };
  assert.equal(officialAscensionToEditValues(legacy).maximumAltitudeM, "141");
});

test("le formulaire de modification reçoit tous les champs officiels préremplis", () => {
  const validated = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    {
      ...defaultOfficialAscensionInput(),
      balloonManufacturer: "Cameron",
      maximumAltitudeM: 982,
      nightFlight: true,
      observations: "Observation conservée",
      officialDurationMinutes: 69,
    },
  );
  assert.deepEqual(officialAscensionToEditValues(validated.officialAscensions[0]), {
    dateIso: validated.officialAscensions[0].dateIso,
    balloonModel: validated.officialAscensions[0].balloonModel,
    balloonManufacturer: "Cameron",
    registration: validated.officialAscensions[0].registration,
    departure: validated.officialAscensions[0].departure,
    arrival: validated.officialAscensions[0].arrival,
    category: validated.officialAscensions[0].category,
    pilotFunction: validated.officialAscensions[0].pilotFunction,
    nightFlight: true,
    maximumAltitudeM: "982",
    officialDurationMinutes: 69,
    flightNature: "STANDARD",
    takeoffCount: "",
    landingCount: "",
    instructorName: "",
    instructorLicenceNumber: "",
    examinerName: "",
    examinerLicenceNumber: "",
    observations: "Observation conservée",
  });
});

test("le mode édition soumet nativement le formulaire officiel", () => {
  const formSource = readFileSync(
    new URL("../components/journal/OfficialAscensionForm.tsx", import.meta.url),
    "utf8",
  );
  const editSource = readFileSync(
    new URL("../journal/ascension/[id]/edit/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(formSource, /form=\{nativeSubmit \? "official-ascension-form"/);
  assert.match(editSource, /nativeSubmit/);
});

test("supprimer une ascension liée conserve le vol GPS et tous ses points", () => {
  const validated = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    defaultOfficialAscensionInput(),
  );
  const journalBefore = structuredClone(validated.journalFlights[0]);
  const removed = removeOfficialAscension(validated, validated.officialAscensions[0].id);
  assert.equal(removed.officialAscensions.length, 0);
  assert.deepEqual(
    { ...removed.journalFlights[0], logbookStatus: journalBefore.logbookStatus },
    journalBefore,
  );
  assert.equal(removed.journalFlights[0].logbookStatus, "CARNET_PENDING");
});

test("les cartes du Carnet exposent uniquement la suppression et conservent l’édition officielle", () => {
  const source = readFileSync(
    new URL("../components/journal/AscensionLog.tsx", import.meta.url),
    "utf8",
  );
  const flightsSource = readFileSync(
    new URL("../components/journal/JournalFlightList.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /useJournalCardSwipe/);
  assert.match(flightsSource, /useJournalCardSwipe/);
  assert.match(source, /onPointerMove=\{onPointerMove\}/);
  assert.match(source, /setOpenSwipeId\(open \? ascension\.id : null\)/);
  assert.match(source, /data-journal-ascension-shell/);
  assert.match(source, /closeSwipeFromOutside/);
  assert.match(source, /MoreHorizontal/);
  assert.doesNotMatch(source, /Renommer<\/button>|RenameAscensionDialog|customTitles/);
  assert.match(source, /Supprimer<\/button>/);
  assert.doesNotMatch(source, /\/journal\/ascension\/\$\{ascension\.id\}\/edit/);

  const detailSource = readFileSync(
    new URL("../components/journal/CompletionAscensionDetail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(detailSource, /\/journal\/ascension\/\$\{ascension\.id\}\/edit/);
});

test("une ancienne valeur de renommage ne peut plus influencer l’identité métier d’une ascension", () => {
  const ascension = {
    id: "legacy-renamed",
    date: "1 août 2026",
    dateIso: "2026-08-01",
    departure: "Bondues",
    arrival: "Mérignies",
    registration: "F-TEST",
    balloonModel: "Test",
    balloonType: "Air chaud",
    function: "Pilote",
    flightType: "Jour",
    maximumAltitudeM: null,
    officialDurationMinutes: 60,
    observations: "",
  };
  assert.equal(getAscensionAutomaticName(ascension), "Bondues → Mérignies");
  const source = readFileSync(new URL("../components/journal/AscensionLog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /balloon-companion-ascension-demo-v1|customTitles|ascensionDemoStorage/);
});

test("les flèches ajustent la durée officielle par une minute sans atteindre zéro", () => {
  assert.equal(adjustOfficialDurationMinutes(69, 1), 70);
  assert.equal(adjustOfficialDurationMinutes(69, -1), 68);
  assert.equal(adjustOfficialDurationMinutes(1, -1), 1);

  const source = readFileSync(
    new URL("../flight/complete/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /displayedOfficialDuration, -1/);
  assert.match(source, /displayedOfficialDuration, 1/);
  assert.doesNotMatch(source, /durée officielle de 5 minutes/);
});

test("l’hydratation EDIT n’est pas annulée lorsque le ballon inféré arrive après le formulaire", () => {
  const source = readFileSync(
    new URL("../components/journal/OfficialAscensionForm.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const timer = window\.setTimeout\(\(\) => \{\s*if \(restoredRef\.current\) return;\s*restoredRef\.current = true;/,
  );
  assert.match(source, /setHydrated\(true\);[\s\S]*?\}, \[pathname\]\);/);
  assert.doesNotMatch(source, /\}, \[inferredBalloonId, pathname\]\);/);
  assert.match(source, /if \(!hydrated \|\| selectedBalloonId \|\| !inferredBalloonId\) return;/);
});

test("70 minutes officielles alimentent le Carnet et le Hero Ring sans modifier les 57 minutes GPS", () => {
  const state = validateOfficialAscension(
    createEmptyFlightCompletionState(),
    DEMO_COMPLETION_FLIGHT_ID,
    { ...defaultOfficialAscensionInput(), officialDurationMinutes: 70 },
  );
  const totals = calculatePilotOfficialTotals(state);
  assert.equal(state.journalFlights[0].durationMinutes, 57);
  assert.equal(state.officialAscensions[0].officialDurationMinutes, 70);
  assert.equal(totals.officialDurationMinutes, 8_265);
  assert.equal(totals.totalHoursExact, 8_265 / 60);
});

test("Je n’ai pas piloté conserve uniquement le Journal et les totaux", () => {
  const pending = ensureCompletionJournalFlight(createEmptyFlightCompletionState());
  const journalOnly = setJournalFlightLogbookStatus(pending, DEMO_COMPLETION_FLIGHT_ID, "JOURNAL_ONLY");
  assert.equal(journalOnly.journalFlights[0].logbookStatus, "JOURNAL_ONLY");
  assert.equal(journalOnly.officialAscensions.length, 0);
  assert.deepEqual(calculatePilotOfficialTotals(journalOnly), calculatePilotOfficialTotals(pending));
});

test("Élève crée une ascension officielle sans modifier la durée ni la trace GPS", () => {
  const pending = ensureCompletionJournalFlight(createEmptyFlightCompletionState());
  const pointsBefore = structuredClone(pending.journalFlights[0].points);
  const validated = validateOfficialAscension(pending, DEMO_COMPLETION_FLIGHT_ID, { ...defaultOfficialAscensionInput(), pilotFunction: "Élève", officialDurationMinutes: 62 });
  assert.equal(validated.journalFlights[0].logbookStatus, "CARNET_VALIDATED");
  assert.equal(validated.journalFlights[0].durationMinutes, 57);
  assert.deepEqual(validated.journalFlights[0].points, pointsBefore);
  assert.equal(validated.officialAscensions[0].pilotFunction, "Élève");
  assert.equal(validated.officialAscensions[0].officialDurationMinutes, 62);
});

test("un vol Journal lié peut être supprimé en conservant ou supprimant son ascension", () => {
  const validated = validateOfficialAscension(createEmptyFlightCompletionState(), DEMO_COMPLETION_FLIGHT_ID, defaultOfficialAscensionInput());
  const kept = removeJournalFlight(validated, DEMO_COMPLETION_FLIGHT_ID, false);
  assert.equal(kept.journalFlights.length, 0);
  assert.equal(kept.officialAscensions.length, 1);
  const removed = removeJournalFlight(validated, DEMO_COMPLETION_FLIGHT_ID, true);
  assert.equal(removed.journalFlights.length, 0);
  assert.equal(removed.officialAscensions.length, 0);
  assert.equal(calculatePilotOfficialTotals(removed).ascensions, 108);
});

test("une ascension manuelle accepte une altitude absente et conserve le temps en minutes", () => {
  const state = addManualOfficialAscension(
    createEmptyFlightCompletionState(),
    "manual-no-altitude",
    { ...manualInput, maximumAltitudeM: null, nightFlight: false, officialDurationMinutes: 75 },
  );
  assert.equal(state.officialAscensions[0].maximumAltitudeM, null);
  assert.equal(state.officialAscensions[0].nightFlight, false);
  assert.equal(state.officialAscensions[0].officialDurationMinutes, 75);
});
