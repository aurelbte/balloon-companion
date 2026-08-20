import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mostRestrictiveQualificationResult, qualificationEventLabel, qualificationStatusLabel } from "./qualificationPresentation.ts";

const page = readFileSync(new URL("../more/profile/qualifications/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../more/profile/qualifications/Qualifications.module.css", import.meta.url), "utf8");
const profile = readFileSync(new URL("../more/profile/page.tsx", import.meta.url), "utf8");

test("la page Qualifications est accessible depuis Profil pilote", () => {
  assert.match(profile, /href="\/more\/profile\/qualifications"/);
  assert.match(profile, /Qualifications &amp; validité/);
  assert.match(page, /Qualifications &amp; validité/);
});

test("les six statuts ont des libellés français non ambigus", () => {
  assert.equal(qualificationStatusLabel("COMPLIANT"), "À jour");
  assert.equal(qualificationStatusLabel("UPCOMING"), "À prévoir");
  assert.equal(qualificationStatusLabel("WARNING"), "Échéance proche");
  assert.equal(qualificationStatusLabel("ACTION_REQUIRED"), "Action requise");
  assert.equal(qualificationStatusLabel("UNKNOWN"), "Données insuffisantes");
  assert.equal(qualificationStatusLabel("NON_APPLICABLE"), "Non concerné");
  assert.match(page, /<p className=\{styles\.reason\}>\{result\.reason\}<\/p>/);
});

test("le résumé multi-classe ne masque jamais un statut plus restrictif", () => {
  assert.equal(mostRestrictiveQualificationResult([{ status: "COMPLIANT", reason: "Classe A" }, { status: "UNKNOWN", reason: "Classe B" }]).status, "UNKNOWN");
  assert.equal(mostRestrictiveQualificationResult([{ status: "WARNING", reason: "Classe A" }, { status: "ACTION_REQUIRED", reason: "Classe B" }]).status, "ACTION_REQUIRED");
});

test("le rendu BPL expose les seuils et les explications moteur", () => {
  assert.match(page, /Expérience récente — 24 mois/);
  assert.match(page, /\/ 6 h/);
  assert.match(page, /Décollages/);
  assert.match(page, /Atterrissages/);
  assert.match(page, /Échéance 48 mois/);
  assert.match(page, /Contrôle de compétences BPL/);
  assert.match(page, /view\.bpl\.overall\.reason/);
});

test("le médical legacy reste clairement identifié avec classe inconnue", () => {
  assert.match(page, /medicalDueDateIso/);
  assert.match(page, /Échéance issue de l’ancien profil/);
  assert.match(page, /classe médicale n’est pas connue/);
});

test("le commercial et les formations sont masqués lorsque l’activité est désactivée", () => {
  const conditions = page.match(/qualifications\.profile\.commercialOperationsEnabled && <section/g) ?? [];
  assert.equal(conditions.length, 2);
  assert.match(page, /Activité commerciale/);
  assert.match(page, /Formations professionnelles/);
  assert.match(page, /Premiers secours \/ PSC1/);
  assert.match(page, /Formation incendie/);
});

test("l’historique utilise les libellés aéronautiques français", () => {
  assert.equal(qualificationEventLabel("TRAINING_FLIGHT_BPL"), "Vol d’entraînement BPL");
  assert.equal(qualificationEventLabel("PROFICIENCY_CHECK_BPL"), "Contrôle de compétences BPL");
  assert.equal(qualificationEventLabel("SKILL_TEST_BPL"), "Examen pratique BPL");
  assert.equal(qualificationEventLabel("COMMERCIAL_REFRESHER_COURSE"), "Cours de remise à niveau commercial");
  assert.doesNotMatch(page, />Training flight|>Proficiency check/i);
  assert.match(page, /FI\(B\) :/);
  assert.match(page, /FE\(B\) :/);
});

test("une ascension liée supprimée est signalée sans masquer l’événement", () => {
  assert.match(page, /officialAscensionDeletedAt/);
  assert.match(page, /Ascension liée supprimée — preuve réglementaire conservée/);
  assert.match(page, /Voir l’ascension liée/);
});

test("l’édition reste limitée aux réglages supportés", () => {
  assert.match(page, /Type de licence/);
  assert.match(page, /Activité commerciale/);
  assert.match(page, /Qualification FI\(B\)/);
  assert.match(page, /Qualification FE\(B\)/);
  assert.doesNotMatch(page, /Créer un événement|Ajouter une qualification/);
});

test("le premier accès montre la configuration prioritaire et masque les calculs", () => {
  assert.match(page, /!qualifications\.profile\.configured/);
  assert.match(page, /Configurez votre profil pour calculer vos qualifications et validités\./);
  assert.match(page, /<QualificationSettingsForm priority/);
  assert.match(page, /if \(!view\) return null/);
});

test("l’enregistrement explicite le profil puis replace les réglages après les résultats", () => {
  assert.match(page, /configuredSettings = \{ \.\.\.settings, configured: true \}/);
  assert.match(page, /setSettings\(configuredSettings\)/);
  assert.match(page, /setQualifications\(next\)/);
  assert.ok(page.lastIndexOf("<QualificationSettingsForm settings=") > page.indexOf("Historique"));
});

test("les cases contrôlées associent toute leur zone tactile au contrôle natif", () => {
  for (const id of ["qualification-commercial", "qualification-fi-b", "qualification-fe-b"]) {
    assert.match(page, new RegExp(`htmlFor="${id}"`));
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(page, /checked=\{settings\.commercialOperationsEnabled\}/);
  assert.match(page, /checked=\{settings\.fiBEnabled\}/);
  assert.match(page, /checked=\{settings\.feBEnabled\}/);
  assert.match(page, /event\.target\.checked/);
  assert.match(styles, /touch-action: manipulation/);
  assert.match(styles, /pointer-events: none/);
});
