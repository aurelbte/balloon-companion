import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
import { createEmptyPilotProfile } from "./pilotProfile.ts";
import { PILOT_PROFILE_STORAGE_KEY } from "./pilotProfileStorage.ts";
import {
  createEmptyQualificationProfile,
  createQualificationEvent,
  legacyQualificationDeadlines,
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
    licenceType: null,
    commercialOperationsEnabled: false,
    fiBEnabled: false,
    feBEnabled: false,
  });
  assert.deepEqual(createEmptyPilotQualificationsState().events, []);
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
  assert.equal(savePilotQualifications({ profile: { licenceType: "BPL", commercialOperationsEnabled: true, fiBEnabled: false, feBEnabled: false }, events: [event] }, storage), true);
  assert.equal(loadPilotQualifications(storage).profile.licenceType, "BPL");
  assert.deepEqual(loadPilotQualifications(storage).events, [event]);
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
