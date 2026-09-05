import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
import { createEmptyPilotProfile } from "./pilotProfile.ts";
import { PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";
import {
  createEmptyQualificationProfile,
  createQualificationEvent,
  legacyQualificationDeadlines,
  normalizeQualificationEvent,
  normalizeQualificationProfile,
} from "./pilotQualifications.ts";
import {
  createEmptyPilotQualificationsState,
  loadPilotQualifications,
  savePilotQualifications,
} from "./pilotQualificationsStorage.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function signedIn(id) {
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id, email: `${id}@example.com`, firstName: "", lastName: "" } });
}

test("les qualifications vides n’inventent aucun privilège", () => {
  assert.deepEqual(createEmptyQualificationProfile(), {
    configured: false,
    historyCoverageStartDate: null,
    declaredBplInitialSituation: { referenceDateIso: null, recentExperienceSatisfied: null },
    declaredCommercialInitialSituations: [],
    licenceType: null,
    bplBalloonClasses: [],
    hotAirBalloonGroupPrivilege: null,
    commercialOperationsEnabled: false,
    fiBEnabled: false,
    feBEnabled: false,
  });
  assert.deepEqual(createEmptyPilotQualificationsState().events, []);
});

test("la couverture historique est conservée dans les scopes GUEST et USER", () => {
  const storage = memoryStorage();
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null }); setRuntimeGuestModeActive(true);
  const profile = { ...createEmptyQualificationProfile(), configured: true, historyCoverageStartDate: "2024-08-20" };
  assert.equal(savePilotQualifications({ profile, events: [] }, storage), true);
  assert.equal(loadPilotQualifications(storage).profile.historyCoverageStartDate, "2024-08-20");
  signedIn("coverage-user");
  assert.equal(savePilotQualifications({ profile: { ...profile, historyCoverageStartDate: "2024-01-01" }, events: [] }, storage), true);
  assert.equal(loadPilotQualifications(storage).profile.historyCoverageStartDate, "2024-01-01");
});

test("les situations initiales déclarées persistent en GUEST et USER et restent supprimables", () => {
  const storage = memoryStorage();
  const declared = { ...createEmptyQualificationProfile(), configured: true, declaredBplInitialSituation: { referenceDateIso: "2026-08-01", recentExperienceSatisfied: true }, declaredCommercialInitialSituations: [{ balloonClass: { classId: "HOT_AIR_BALLOON" }, referenceDateIso: "2026-08-01", recencySatisfied: false }] };
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null }); setRuntimeGuestModeActive(true);
  assert.equal(savePilotQualifications({ profile: declared, events: [] }, storage), true);
  assert.deepEqual(loadPilotQualifications(storage).profile.declaredBplInitialSituation, declared.declaredBplInitialSituation);
  signedIn("declared-user");
  assert.equal(savePilotQualifications({ profile: declared, events: [] }, storage), true);
  const removed = { ...loadPilotQualifications(storage).profile, declaredBplInitialSituation: { referenceDateIso: null, recentExperienceSatisfied: null }, declaredCommercialInitialSituations: [] };
  assert.equal(savePilotQualifications({ profile: removed, events: [] }, storage), true);
  assert.deepEqual(loadPilotQualifications(storage).profile.declaredCommercialInitialSituations, []);
  assert.equal(loadPilotQualifications(storage).profile.declaredBplInitialSituation.recentExperienceSatisfied, null);
});

test("un événement reçoit un UUID stable et des timestamps sérialisables", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  const event = createQualificationEvent(
    { type: "TRAINING_FLIGHT_BPL", dateIso: "2026-08-20", source: "MANUAL", instructor: { name: "Jean Pilote", licenceNumber: "FI-42" } },
    { uuid: () => uuid, now: () => new Date("2026-08-20T10:00:00.000Z") },
  );
  assert.equal(event.id, uuid);
  assert.equal(event.createdAt, "2026-08-20T10:00:00.000Z");
  assert.equal(event.updatedAt, event.createdAt);
  assert.deepEqual(JSON.parse(JSON.stringify(event)), event);
});

test("la persistance conserve profil et événements dans le scope USER", () => {
  const storage = memoryStorage();
  signedIn("user-a");
  const event = createQualificationEvent(
    { type: "FIRST_AID", dateIso: "2026-08-01", expiryDateIso: "2028-08-01", source: "MANUAL" },
    { uuid: () => "123e4567-e89b-42d3-a456-426614174001", now: () => new Date("2026-08-20T10:00:00Z") },
  );
  assert.equal(savePilotQualifications({ profile: { configured: true, licenceType: "BPL", commercialOperationsEnabled: true, fiBEnabled: false, feBEnabled: false }, events: [event] }, storage), true);
  assert.equal(loadPilotQualifications(storage).profile.licenceType, "BPL");
  assert.equal(loadPilotQualifications(storage).profile.configured, true);
  assert.deepEqual(loadPilotQualifications(storage).events, [event]);
});

test("le marqueur explicite distingue les valeurs par défaut d’une configuration volontaire", () => {
  assert.equal(normalizeQualificationProfile({ licenceType: null, commercialOperationsEnabled: false, fiBEnabled: false, feBEnabled: false }).configured, false);
  assert.equal(normalizeQualificationProfile({ configured: true, licenceType: null, commercialOperationsEnabled: false, fiBEnabled: false, feBEnabled: false }).configured, true);
});

test("une configuration volontaire avec les valeurs par défaut reste configurée au rechargement", () => {
  const storage = memoryStorage();
  signedIn("configured-defaults-user");
  const profile = { ...createEmptyQualificationProfile(), configured: true };
  assert.equal(savePilotQualifications({ profile, events: [] }, storage), true);
  assert.deepEqual(loadPilotQualifications(storage).profile, profile);
});

test("un invité configure sa BPL sur stockage vide et la retrouve au rechargement", () => {
  const storage = memoryStorage();
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.equal(loadPilotQualifications(storage).profile.configured, false);
  const profile = { ...createEmptyQualificationProfile(), configured: true, licenceType: "BPL" };
  assert.equal(savePilotQualifications({ profile, events: [] }, storage), true);
  const reloaded = loadPilotQualifications(storage).profile;
  assert.equal(reloaded.configured, true);
  assert.equal(reloaded.licenceType, "BPL");
});

test("un ancien profil Qualifications renseigné sans marqueur reste configuré", () => {
  assert.equal(normalizeQualificationProfile({ licenceType: "BPL", commercialOperationsEnabled: false, fiBEnabled: false, feBEnabled: false }).configured, true);
});

test("les scopes USER et GUEST restent isolés", () => {
  const storage = memoryStorage();
  signedIn("user-a");
  savePilotQualifications({ profile: { ...createEmptyQualificationProfile(), licenceType: "BPL" }, events: [] }, storage);
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.equal(loadPilotQualifications(storage).profile.licenceType, null);
  savePilotQualifications({ profile: { ...createEmptyQualificationProfile(), licenceType: "GUEST-LICENCE" }, events: [] }, storage);
  signedIn("user-a");
  assert.equal(loadPilotQualifications(storage).profile.licenceType, "BPL");
  signedIn("user-b");
  assert.equal(loadPilotQualifications(storage).profile.licenceType, null);
});

test("les privilèges BPL sont normalisés, dédupliqués et persistés par scope", () => {
  assert.deepEqual(normalizeQualificationProfile({ bplBalloonClasses: ["GAS_BALLOON", "MIXED", "HOT_AIR_BALLOON", "GAS_BALLOON"] }).bplBalloonClasses, ["HOT_AIR_BALLOON", "GAS_BALLOON"]);
  assert.deepEqual(normalizeQualificationProfile({}).bplBalloonClasses, []);
  const storage = memoryStorage();
  signedIn("classes-a");
  savePilotQualifications({ profile: { ...createEmptyQualificationProfile(), bplBalloonClasses: ["GAS_BALLOON"] }, events: [] }, storage);
  assert.deepEqual(loadPilotQualifications(storage).profile.bplBalloonClasses, ["GAS_BALLOON"]);
  signedIn("classes-b");
  assert.deepEqual(loadPilotQualifications(storage).profile.bplBalloonClasses, []);
});

test("le privilège de groupe hot-air accepte seulement A à D sans aucune déduction", () => {
  for (const group of ["A", "B", "C", "D"]) assert.equal(normalizeQualificationProfile({ hotAirBalloonGroupPrivilege: group }).hotAirBalloonGroupPrivilege, group);
  assert.equal(normalizeQualificationProfile({ hotAirBalloonGroupPrivilege: "E" }).hotAirBalloonGroupPrivilege, null);
  assert.equal(normalizeQualificationProfile({ bplBalloonClasses: ["HOT_AIR_BALLOON"] }).hotAirBalloonGroupPrivilege, null);
});

test("groupId est strictement validé pour hot-air et supprimé pour gas", () => {
  const base = { id: "123e4567-e89b-42d3-a456-426614174099", type: "TRAINING_FLIGHT_BPL", dateIso: "2026-01-01", source: "MANUAL", instructor: { name: "FI" }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  assert.equal(createQualificationEvent({ type: "TRAINING_FLIGHT_BPL", dateIso: "2026-01-01", source: "MANUAL", balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "D" }, instructor: { name: "FI" } }).balloonClass.groupId, "D");
  assert.equal(normalizeQualificationEvent({ ...base, balloonClass: { classId: "HOT_AIR_BALLOON", groupId: "X" } }).balloonClass.groupId, undefined);
  assert.equal(normalizeQualificationEvent({ ...base, balloonClass: { classId: "GAS_BALLOON", groupId: "A" } }).balloonClass.groupId, undefined);
});

test("l’adaptateur legacy expose les échéances sans créer ni reclasser d’événement", () => {
  const storage = memoryStorage();
  signedIn("legacy-user");
  const legacy = { ...createEmptyPilotProfile(), flightTestDueDateIso: "2027-12-31", medicalDueDateIso: "2026-11-30" };
  storage.setItem(`balloon-companion-user-data-v1:legacy-user:${PILOT_PROFILE_STORAGE_KEY}`, JSON.stringify(legacy));
  const before = storage.getItem(`balloon-companion-user-data-v1:legacy-user:${PILOT_PROFILE_STORAGE_KEY}`);
  const state = loadPilotQualifications(storage);
  assert.deepEqual(state.legacy, { flightTestDueDateIso: "2027-12-31", medicalDueDateIso: "2026-11-30" });
  assert.deepEqual(state.events, []);
  assert.equal(storage.getItem(`balloon-companion-user-data-v1:legacy-user:${PILOT_PROFILE_STORAGE_KEY}`), before);
  assert.deepEqual(legacyQualificationDeadlines(legacy), state.legacy);
});
