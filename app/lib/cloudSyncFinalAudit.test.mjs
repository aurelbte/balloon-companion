import assert from "node:assert/strict";
import test from "node:test";
import { classifyFinalAuditMutations, isLegacyLocalOnlyMutation } from "./cloudSyncFinalAudit.ts";

const mutation = (overrides = {}) => ({
  entityType: "flight",
  entityId: "flight-1",
  attempts: 0,
  conflict: false,
  orphan: false,
  testResidual: false,
  localOnly: false,
  ...overrides,
});

test("flight-completion singleton est local-only, non orphan et ne bloque pas CLEAN", () => {
  const localOnly = mutation({ entityType: "flight-completion", entityId: "singleton", localOnly: true, conflict: true, orphan: true, testResidual: true });
  assert.equal(isLegacyLocalOnlyMutation(localOnly), true);
  const result = classifyFinalAuditMutations([localOnly]);
  assert.equal(result.localOnlyMutations.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.orphanMutations.length, 0);
  assert.equal(result.testResiduals.length, 0);
  assert.equal(result.overall, "CLEAN");
});

test("une mutation inconnue sans payload reste orphan et bloque", () => {
  const result = classifyFinalAuditMutations([mutation({ entityType: "unknown", orphan: true })]);
  assert.equal(result.orphanMutations.length, 1);
  assert.equal(result.overall, "BLOCKED");
});

test("un conflit Cloud réel reste bloquant", () => {
  assert.equal(classifyFinalAuditMutations([mutation({ conflict: true })]).overall, "BLOCKED");
});

test("un résidu de test Cloud reste détecté", () => {
  const result = classifyFinalAuditMutations([mutation({ testResidual: true })]);
  assert.equal(result.testResiduals.length, 1);
  assert.equal(result.overall, "ATTENTION");
});

test("une outbox vide est CLEAN", () => {
  assert.equal(classifyFinalAuditMutations([]).overall, "CLEAN");
});

test("local-only légitime sans anomalie Cloud reste CLEAN", () => {
  const result = classifyFinalAuditMutations([
    mutation({ entityType: "flight-completion", entityId: "singleton", localOnly: true }),
  ]);
  assert.equal(result.localOnlyMutations.length, 1);
  assert.equal(result.overall, "CLEAN");
});
