import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../components/journal/JournalFlightList.tsx", import.meta.url), "utf8");
const sharedSwipe = readFileSync(new URL("../hooks/useJournalCardSwipe.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../journal/Journal.module.css", import.meta.url), "utf8");

test("la carte conserve le titre sur deux lignes et des valeurs non tronquées", () => {
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /\.flightMetrics\s*>\s*span\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(component, /Décollage \$\{flight\.takeoffTime\}/);
});

test("le menu appartient à l'en-tête et reste hors de la miniature", () => {
  const headerIndex = component.indexOf("flightCardHeader");
  const buttonIndex = component.indexOf("flightMoreButton", headerIndex);
  const thumbnailIndex = component.indexOf("styles.thumbnail", headerIndex);
  assert.ok(headerIndex >= 0 && buttonIndex > headerIndex && thumbnailIndex > buttonIndex);
});

test("la miniature reste secondaire et le swipe conserve ses seuils", () => {
  assert.match(css, /minmax\(76px, 27%\)/);
  assert.match(component, /useJournalCardSwipe/);
  assert.match(sharedSwipe, /journalSwipeDestination/);
  assert.match(sharedSwipe, /JOURNAL_SWIPE_ACTIONS_WIDTH_PX/);
});
