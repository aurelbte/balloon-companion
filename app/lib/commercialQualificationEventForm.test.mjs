import assert from "node:assert/strict";
import test from "node:test";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";
import { emptyCommercialEventDraft, upsertCommercialQualificationEvent } from "./commercialQualificationEventForm.ts";
import { createEmptyQualificationProfile, createQualificationEvent } from "./pilotQualifications.ts";
import { removeQualificationEvent } from "./qualificationEventForm.ts";
import { loadPilotQualifications, savePilotQualifications } from "./pilotQualificationsStorage.ts";

const hotAir = "HOT_AIR_BALLOON";
let sequence = 300;
const options = () => ({ uuid: () => `123e4567-e89b-42d3-a456-${String(++sequence).padStart(12, "0")}`, now: () => new Date("2026-08-20T10:00:00Z") });
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }

test("délivrance, contrôle et remise à niveau restent trois événements distincts", () => {
  let result = upsertCommercialQualificationEvent([], "INITIAL_COMMERCIAL_ISSUANCE", { ...emptyCommercialEventDraft(), dateIso: "2025-01-01", classId: hotAir }, undefined, options());
  assert.equal(result.ok, true);
  const training = createQualificationEvent({ type: "TRAINING_FLIGHT_BPL", dateIso: "2026-01-02", source: "MANUAL", balloonClass: { classId: hotAir }, instructor: { name: "FI Test" } }, options());
  result = upsertCommercialQualificationEvent([...result.events, training], "COMMERCIAL_PROFICIENCY_CHECK", { ...emptyCommercialEventDraft(), dateIso: "2026-02-01", classId: hotAir, personName: "FE Test" }, undefined, options());
  assert.equal(result.ok, true);
  result = upsertCommercialQualificationEvent(result.events, "COMMERCIAL_REFRESHER_COURSE", { ...emptyCommercialEventDraft(), dateIso: "2026-03-01", classId: hotAir, theoryMinutes: "360", trainingEventId: training.id }, undefined, options());
  assert.equal(result.ok, true);
  assert.deepEqual(result.events.map(({ type }) => type), ["INITIAL_COMMERCIAL_ISSUANCE", "TRAINING_FLIGHT_BPL", "COMMERCIAL_PROFICIENCY_CHECK", "COMMERCIAL_REFRESHER_COURSE"]);
});

test("la remise à niveau refuse un vol FI(B) absent ou d’une autre classe", () => {
  const draft = { ...emptyCommercialEventDraft(), dateIso: "2026-03-01", classId: hotAir, theoryMinutes: "360", trainingEventId: "missing" };
  const result = upsertCommercialQualificationEvent([], "COMMERCIAL_REFRESHER_COURSE", draft);
  assert.equal(result.ok, false);
  assert.match(result.error, /même classe/);
});

test("GUEST ajoute, modifie, supprime et recharge une délivrance professionnelle", () => {
  const local = storage();
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null }); setRuntimeGuestModeActive(true);
  const created = upsertCommercialQualificationEvent([], "INITIAL_COMMERCIAL_ISSUANCE", { ...emptyCommercialEventDraft(), dateIso: "2025-01-01", classId: hotAir }, undefined, options());
  assert.equal(created.ok, true);
  const profile = { ...createEmptyQualificationProfile(), configured: true, commercialOperationsEnabled: true };
  assert.equal(savePilotQualifications({ profile, events: created.events }, local), true);
  const reloaded = loadPilotQualifications(local);
  const edited = upsertCommercialQualificationEvent(reloaded.events, "INITIAL_COMMERCIAL_ISSUANCE", { ...emptyCommercialEventDraft(reloaded.events[0]), dateIso: "2025-02-01" }, reloaded.events[0].id, options());
  assert.equal(edited.ok, true); assert.equal(edited.events.length, 1);
  assert.equal(savePilotQualifications({ profile, events: edited.events }, local), true);
  assert.equal(loadPilotQualifications(local).events[0].dateIso, "2025-02-01");
  assert.equal(savePilotQualifications({ profile, events: removeQualificationEvent(edited.events, edited.event.id) }, local), true);
  assert.equal(loadPilotQualifications(local).events.length, 0);
});

test("USER conserve les événements professionnels dans son scope", () => {
  const local = storage(); setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "phase-7c", email: "pilot@example.com", firstName: "", lastName: "" } });
  const created = upsertCommercialQualificationEvent([], "COMMERCIAL_PROFICIENCY_CHECK", { ...emptyCommercialEventDraft(), dateIso: "2026-01-01", classId: hotAir, personName: "FE Test" }, undefined, options());
  assert.equal(created.ok, true);
  const profile = { ...createEmptyQualificationProfile(), configured: true, commercialOperationsEnabled: true };
  assert.equal(savePilotQualifications({ profile, events: created.events }, local), true);
  assert.equal(loadPilotQualifications(local).events[0].examiner.name, "FE Test");
});
