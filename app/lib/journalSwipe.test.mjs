import assert from "node:assert/strict";
import test from "node:test";
import { journalSwipeAxis, journalSwipeOffset, JOURNAL_SWIPE_ACTIONS_WIDTH_PX, shouldOpenJournalSwipe } from "./journalSwipe.ts";
import { readFileSync } from "node:fs";

test("un glissement horizontal ouvre les actions au-delà du seuil", () => {
  assert.equal(journalSwipeAxis(-70, 8), "horizontal");
  assert.equal(shouldOpenJournalSwipe(journalSwipeOffset(-70, false)), true);
  assert.equal(journalSwipeOffset(-500, false), -JOURNAL_SWIPE_ACTIONS_WIDTH_PX);
});

test("un mouvement principalement vertical laisse le scroll intact", () => {
  assert.equal(journalSwipeAxis(-12, 48), "vertical");
  assert.equal(journalSwipeAxis(-4, 5), null);
});

test("la liste n’utilise plus appui long, contextmenu ou aperçu de lien englobant", () => {
  const source = readFileSync(new URL("../components/journal/JournalFlightList.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /LONG_PRESS|onContextMenu|setTimeout\([^)]*onOpenMenu/);
  assert.doesNotMatch(source, /<Link[\s\S]*className=.*flightCard/);
  assert.match(source, /aria-label={`Modifier le vol du/);
  assert.match(source, /aria-label={`Supprimer le vol du/);
  assert.match(source, /flightMoreButton/);
});
