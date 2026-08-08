import test from "node:test";
import assert from "node:assert/strict";
import { buildUltramagicTraceabilityAudit, ultramagicModelParameters } from "./ultramagicModels.ts";

test("le registre Ultramagic FM04 Revision 30 est complet et non activé", () => {
  assert.equal(ultramagicModelParameters.length, 50);
  assert.equal(new Set(ultramagicModelParameters.map(({ id }) => id)).size, 50);
  assert.equal(new Set(ultramagicModelParameters.map(({ model }) => model)).size, 50);
  for (const entry of ultramagicModelParameters) {
    assert.equal(entry.manufacturer, "Ultramagic");
    assert.ok((entry.volumeM3 ?? 0) > 0);
    assert.ok((entry.standardMtomKg ?? 0) > 0);
    assert.ok((entry.reducedMtomKg ?? 0) > 0);
    assert.ok(entry.reducedMtomKg <= entry.standardMtomKg);
    assert.equal(entry.source.manualId, "ULTRAMAGIC_FM04_REV30");
    assert.equal(entry.source.manualRevision, "FM04_REVISION_30");
    assert.ok(entry.source.pages.length > 0);
    assert.equal(entry.verificationStatus, "CANDIDATE_PILOT_VALIDATION");
  }
});

test("l’audit trace les 50 modèles sans supplément indispensable", () => {
  const audit = buildUltramagicTraceabilityAudit();
  assert.equal(audit.length, 50);
  assert.ok(audit.every(({ volume }) => volume === "CONFIRMED"));
  assert.ok(audit.every(({ mtom }) => mtom === "STANDARD_AND_REDUCED_DOCUMENTED"));
  assert.ok(audit.every(({ fm04 }) => fm04 === "APPLICABLE"));
  assert.ok(audit.every(({ supplement }) => supplement === "NOT_REQUIRED"));
  assert.ok(audit.every(({ status }) => status === "CANDIDATE_PILOT_VALIDATION"));
});

test("les variantes proches restent des entrées exactes distinctes", () => {
  const byModel = new Map(ultramagicModelParameters.map((entry) => [entry.model, entry]));
  assert.notEqual(byModel.get("M56")?.id, byModel.get("M56C")?.id);
  assert.notEqual(byModel.get("M65")?.id, byModel.get("M65Z")?.id);
  assert.notEqual(byModel.get("N425")?.id, byModel.get("N450")?.id);
});
