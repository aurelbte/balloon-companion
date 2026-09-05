import assert from "node:assert/strict";
import test from "node:test";
import { emptyFiBEventDraft, upsertFiBQualificationEvent } from "./fiBQualificationEventForm.ts";

test("les trois événements FI(B) réutilisent QualificationEvent avec leurs preuves minimales", () => {
  const options = { uuid: () => "123e4567-e89b-42d3-a456-426614174000", now: () => new Date("2026-09-05T00:00:00Z") };
  const refresher = upsertFiBQualificationEvent([], "FI_B_REFRESHER_TRAINING", { ...emptyFiBEventDraft(), dateIso: "2026-01-01" }, undefined, options);
  assert.equal(refresher.ok && refresher.event.type, "FI_B_REFRESHER_TRAINING");
  const supervised = upsertFiBQualificationEvent([], "FI_B_SUPERVISED_INSTRUCTION", { dateIso: "2026-01-02", officialAscensionId: "asc-1", classId: "HOT_AIR_BALLOON", personName: "FI Test", notes: "" }, undefined, options);
  assert.equal(supervised.ok && supervised.event.instructor?.name, "FI Test");
  const aoc = upsertFiBQualificationEvent([], "FI_B_ASSESSMENT_OF_COMPETENCE", { dateIso: "2026-01-03", officialAscensionId: "asc-2", classId: "GAS_BALLOON", personName: "FE Test", notes: "" }, undefined, options);
  assert.equal(aoc.ok && aoc.event.examiner?.name, "FE Test");
});
