import test from "node:test";
import assert from "node:assert/strict";
import {
  auditCameronModelParameters,
  buildCameronTraceabilityAudit,
  cameronModelParameters,
  cameronZ105Parameters,
  resolveCameronModelParameters,
} from "./cameronModels.ts";

test("le registre Cameron Issue 10 Amendment 18 est cohérent", () => {
  assert.equal(cameronModelParameters.length, 28);
  assert.deepEqual(auditCameronModelParameters(), []);
});

test("l’audit confirme paramètres, méthode A2, source et statut des 28 modèles", () => {
  const audit = buildCameronTraceabilityAudit();
  assert.equal(audit.length, 28);
  assert.ok(audit.every((row) => row.parameters === "CONFIRMED"));
  assert.ok(audit.every((row) => row.a2Applicable));
  assert.ok(audit.every((row) => row.source.includes("CAMERON_ISSUE_10_AMENDMENT_18")));
  assert.ok(audit.every((row) => row.status === "CANDIDATE_PILOT_VALIDATION"));
});

test("Z105 reste exactement le candidat pilote existant", () => {
  assert.equal(cameronZ105Parameters.id, "CAMERON_Z105");
  assert.equal(cameronZ105Parameters.volumeM3, 2_974);
  assert.equal(cameronZ105Parameters.standardMtomKg, 952);
  assert.equal(cameronZ105Parameters.verificationStatus, "CANDIDATE_PILOT_VALIDATION");
});

test("les paramètres ciblés correspondent à la Table 2", () => {
  assert.deepEqual(
    ["Z-350", "Z-425LW", "Z-120", "Z-150"].map((model) => {
      const entry = resolveCameronModelParameters(model);
      return [model, entry?.volumeM3, entry?.standardMtomKg];
    }),
    [
      ["Z-350", 9_912, 3_175],
      ["Z-425LW", 12_036, 3_662],
      ["Z-120", 3_398, 1_088],
      ["Z-150", 4_248, 1_361],
    ],
  );
});

test("une désignation ambiguë ne résout jamais une variante LW", () => {
  assert.equal(resolveCameronModelParameters("Z425"), null);
  assert.equal(resolveCameronModelParameters("Z340"), null);
});
