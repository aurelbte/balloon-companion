import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyPilotProfile, formatProfileDate, normalizePilotProfile, remainingMonthsUntil } from "./pilotProfile.ts";
test("un profil vide n’invente aucune donnée réglementaire", () => { assert.deepEqual(createEmptyPilotProfile(), { version: 1, firstName: "", lastName: "", licenseNumber: "", usualFunction: null, flightTestDueDateIso: "", medicalDueDateIso: "" }); });
test("le profil normalise l’identité sans dupliquer l’expérience", () => { const profile = normalizePilotProfile({ firstName: " Aurélien ", lastName: " Boitte ", licenseNumber: " ppl-123 ", usualFunction: "Pilote", flightTestDueDateIso: "2027-04-30", medicalDueDateIso: "2028-05-04", hours: 120 }); assert.equal(profile.licenseNumber, "PPL-123"); assert.equal("hours" in profile, false); });
test("les échéances produisent un affichage factuel", () => { assert.equal(remainingMonthsUntil("2027-04-30", new Date("2026-08-01T12:00:00Z")), 9); assert.equal(formatProfileDate("2027-04-30"), "30/04/2027"); assert.equal(remainingMonthsUntil("", new Date()), null); });
