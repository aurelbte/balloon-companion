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

test("la fiche réutilise les données pilote et les totaux officiels", () => {
  assert.match(component, /usePilotProfile\(\)/);
  assert.match(component, /useFlightCompletionState\(\)/);
  assert.match(component, /calculatePilotOfficialTotals\(completion\)/);
  assert.doesNotMatch(component, /savePilotProfile|persistPilotExperience|localStorage|indexedDB/i);
});

test("Modifier ouvre directement l'éditeur existant", () => {
  assert.match(component, /router\.push\("\/more\/profile\/experience"\)/);
});

test("la fiche plein écran respecte les safe areas sans modifier la grille dashboard", () => {
  assert.match(css, /\.pilotStatusDetail\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
  assert.match(css, /\.pilotStatusDetailHeader\s*\{[^}]*safe-area-inset-top/s);
  assert.match(css, /\.pilotStatusDetailFooter\s*\{[^}]*safe-area-inset-bottom/s);
  assert.match(css, /\.pair\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
});
