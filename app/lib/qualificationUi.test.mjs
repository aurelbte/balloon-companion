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
  assert.match(page, /if \(status === "UNKNOWN"\) return "À compléter"/);
});

test("le résumé multi-classe ne masque jamais un statut plus restrictif", () => {
  assert.equal(mostRestrictiveQualificationResult([{ status: "COMPLIANT", reason: "Classe A" }, { status: "UNKNOWN", reason: "Classe B" }]).status, "UNKNOWN");
  assert.equal(mostRestrictiveQualificationResult([{ status: "WARNING", reason: "Classe A" }, { status: "ACTION_REQUIRED", reason: "Classe B" }]).status, "ACTION_REQUIRED");
});

test("le rendu BPL expose les seuils et les explications moteur", () => {
  assert.match(page, /Expérience récente — 24 mois/);
  assert.match(page, /\/ 6 h/);
  assert.match(page, /décollages/);
  assert.match(page, /atterrissages/);
  assert.match(page, /Aucun vol d’entraînement enregistré/);
  assert.match(page, /Aucun contrôle enregistré/);
});

test("le médical legacy reste clairement identifié avec classe inconnue", () => {
  assert.match(page, /medicalDueDateIso/);
  assert.match(page, /Échéance antérieure conservée/);
  assert.match(page, /Classe médicale à renseigner/);
});

test("le commercial et les formations sont masqués lorsque l’activité est désactivée", () => {
  const conditions = page.match(/qualifications\.profile\.commercialOperationsEnabled && <section/g) ?? [];
  assert.equal(conditions.length, 1);
  assert.match(page, /Activité professionnelle/);
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

test("l’enregistrement explicite le profil puis revient à la fiche", () => {
  assert.match(page, /configuredSettings = \{ \.\.\.settings, configured: true \}/);
  assert.match(page, /setSettings\(configuredSettings\)/);
  assert.match(page, /setQualifications\(next\)/);
  assert.match(page, /setEditing\(false\)/);
  assert.match(page, /Modifier ma situation/);
  assert.doesNotMatch(page, />Réglages</);
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

test("le bouton Enregistrer passe exclusivement par un submit de formulaire protégé", () => {
  assert.match(page, /<form[^>]+onSubmit=\{onSubmit\}/);
  assert.match(page, /type="submit"/);
  assert.match(page, /event\.preventDefault\(\)/);
  assert.match(page, /lastSubmittedProfile\.current === submissionKey/);
  assert.match(page, /<button className=\{styles\.save\} type="submit">Enregistrer<\/button>/);
  assert.match(styles, /\.save \{[^}]*pointer-events: auto/);
  assert.match(styles, /\.save \{[^}]*touch-action: manipulation/);
});

test("la fiche est ordonnée synthèse, actions, BPL, professionnel puis historique", () => {
  const markers = ["Résumé de la situation pilote", 'id="todo-title"', 'id="bpl-title"', 'id="commercial-title"', 'id="history-title"'];
  for (let index = 1; index < markers.length; index += 1) assert.ok(page.indexOf(markers[index - 1]) < page.indexOf(markers[index]));
  assert.match(page, /Votre dossier est à jour\./);
  assert.match(page, /dans l’historique/);
});

test("la phase 7A utilise des formulaires natifs compacts et rafraîchit immédiatement les événements", () => {
  assert.match(page, /function QualificationEventForm/);
  assert.match(page, /<form className=\{styles\.eventForm\} onSubmit=\{onSubmit\}>/);
  assert.match(page, /type="date"/);
  assert.match(page, /required=\{medical\}/);
  assert.match(page, /event\.preventDefault\(\)/);
  assert.match(page, /upsertQualificationEvent/);
  assert.match(page, /savePilotQualifications\(\{ profile: qualifications\.profile, events: result\.events \}/);
  assert.match(page, /setQualifications\(next\)/);
  assert.match(page, /Organisme : \{event\.organization\}/);
});
