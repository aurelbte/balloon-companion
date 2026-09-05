import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/cockpit/PilotStatusCard.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/cockpit/Cockpit.module.css", import.meta.url), "utf8");

test("la carte entière ouvre une fiche fermable", () => {
  assert.match(component, /pilotStatusTrigger[\s\S]*onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /pilotStatusClose[\s\S]*onClick=\{\(\) => setOpen\(false\)\}[\s\S]*aria-label="Fermer la fiche Statut pilote"/);
});

test("la carte cockpit reste une synthèse alignée sur les autres cartes", () => {
  assert.match(component, /<Card className=\{`\$\{styles\.card\} \$\{styles\.summaryCard\}`\}>/);
  assert.match(component, /Statut global/);
  assert.match(component, /Prêt à voler/);
  assert.match(component, /Attention/);
  assert.match(component, /Non conforme/);
  assert.match(component, /Vol test/);
  assert.match(component, /Médical/);
  assert.match(component, /Voir le détail →/);
  assert.doesNotMatch(component.slice(component.indexOf("pilotStatusTrigger"), component.indexOf("{open &&")), /mois restants|Échéance/);
});

test("la fiche utilise exclusivement Qualifications et validité pour ses statuts", () => {
  assert.match(component, /usePilotProfile\(\)/);
  assert.match(component, /useFlightCompletionState\(\)/);
  assert.match(component, /calculatePilotOfficialTotals\(completion\)/);
  assert.match(component, /loadPilotQualifications/);
  assert.match(component, /calculateBplPrivilegesMaintenance/);
  assert.match(component, /calculateMedicalQualification/);
  assert.match(component, /bpl\.overall\.status/);
  assert.match(component, /bpl\.referenceRequirement\?\.trainingFlightFiB/);
  assert.match(component, /medical\.overall/);
  assert.doesNotMatch(component, /profile\.flightTestDueDateIso|profile\.medicalDueDateIso/);
  assert.doesNotMatch(component, /savePilotProfile|persistPilotExperience|localStorage|indexedDB/i);
});

test("Modifier ouvre l'éditeur Qualifications et validité", () => {
  assert.match(component, /router\.push\("\/more\/profile\/qualifications"\)/);
});

test("Mes informations ne présente plus les anciennes échéances", () => {
  const informationPage = readFileSync(new URL("../more/profile/experience/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(informationPage, /<h2>Échéances<\/h2>|Prochain vol test|Validité médicale/);
  assert.match(informationPage, /<h2>Identité<\/h2>/);
  assert.match(informationPage, /<h2>Expérience avant Balloon Companion<\/h2>/);
});

test("la fiche plein écran respecte les safe areas sans modifier la grille dashboard", () => {
  assert.match(css, /\.pilotStatusDetail\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
  assert.match(css, /\.pilotStatusDetailHeader\s*\{[^}]*safe-area-inset-top/s);
  assert.match(css, /\.pilotStatusDetailFooter\s*\{[^}]*safe-area-inset-bottom/s);
  assert.match(css, /\.pair\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
});
