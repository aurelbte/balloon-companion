import test from "node:test";
import assert from "node:assert/strict";
import { createScopedOfficialAscensionDraft, parseScopedOfficialAscensionDraft } from "./officialAscensionDraft.ts";

test("le brouillon manuel conserve une date volontairement choisie au retour", () => {
  const draft = createScopedOfficialAscensionDraft(
    "/journal/ascension/new",
    { dateIso: "2024-06-15" },
    "60",
  );
  assert.deepEqual(
    parseScopedOfficialAscensionDraft(JSON.stringify(draft), "/journal/ascension/new"),
    draft,
  );
});

test("un brouillon GPS ne peut jamais présélectionner la date du formulaire manuel", () => {
  const gpsDraft = createScopedOfficialAscensionDraft(
    "/flight/complete/ascension",
    { dateIso: "2026-08-01" },
    "57",
  );
  assert.equal(
    parseScopedOfficialAscensionDraft(JSON.stringify(gpsDraft), "/journal/ascension/new"),
    null,
  );
});

test("un ancien brouillon non contextualisé est ignoré", () => {
  assert.equal(
    parseScopedOfficialAscensionDraft(JSON.stringify({ values: { dateIso: "2026-08-01" }, durationMinutes: "57" }), "/journal/ascension/new"),
    null,
  );
});
