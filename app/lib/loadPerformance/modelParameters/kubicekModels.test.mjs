import assert from "node:assert/strict";
import test from "node:test";
import { findExactKubicekModel, kubicekModelParameters } from "./kubicekModels.ts";

test("registre Kubíček Rev.19 traçable et sans identifiant dupliqué", () => {
  assert.equal(new Set(kubicekModelParameters.map(({ id }) => id)).size, kubicekModelParameters.length);
  for (const model of kubicekModelParameters) {
    assert.ok(model.volumeM3 > 0);
    assert.ok(model.volumeCuFt > 0);
    assert.ok(model.standardMtomKg > 0);
    assert.equal(model.source.manualId, "KUBICEK_B3102_ED3_REV19");
    assert.match(model.source.manualRevision, /Revision 19/);
    assert.ok(model.source.pages.length > 0);
    assert.equal(model.verificationStatus, "CANDIDATE_PILOT_VALIDATION");
    assert.equal(model.reducedMtomKg, undefined);
  }
});

test("modèles représentatifs du début, milieu et haut de gamme", () => {
  assert.deepEqual(findExactKubicekModel("BB9"), expectModel("BB9", 900, 31_800, 295));
  assert.deepEqual(findExactKubicekModel("BB45Z"), expectModel("BB45Z", 4_500, 160_200, 1_520));
  assert.deepEqual(findExactKubicekModel("BB184P"), expectModel("BB184P", 18_400, 650_000, 5_095));
});

test("aucune désignation ambiguë ou proche n'est résolue", () => {
  assert.equal(findExactKubicekModel("BB20E"), kubicekModelParameters.find(({ model }) => model === "BB20E"));
  assert.equal(findExactKubicekModel("BB20"), kubicekModelParameters.find(({ model }) => model === "BB20"));
  assert.equal(findExactKubicekModel("BB20 E"), undefined);
  assert.equal(findExactKubicekModel("bb20"), undefined);
  assert.equal(findExactKubicekModel("BB22GP"), undefined);
});

function expectModel(model, volumeM3, volumeCuFt, standardMtomKg) {
  return kubicekModelParameters.find((entry) => entry.model === model && entry.volumeM3 === volumeM3 && entry.volumeCuFt === volumeCuFt && entry.standardMtomKg === standardMtomKg);
}
