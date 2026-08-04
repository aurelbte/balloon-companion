import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  journalSwipeAxis,
  journalSwipeDestination,
  journalSwipeInitialOffset,
  journalSwipeOffset,
  JOURNAL_SWIPE_ACTIONS_WIDTH_PX,
} from "./journalSwipe.ts";

test("CLOSED s'ouvre après un glissement gauche suffisant", () => {
  assert.equal(journalSwipeDestination({ initialState: "closed", deltaX: -52, velocityX: -0.1 }), "open");
  assert.equal(journalSwipeOffset(-80, journalSwipeInitialOffset("closed")), -80);
});

test("OPEN se ferme en un seul glissement depuis son offset réel", () => {
  const initial = journalSwipeInitialOffset("open");
  assert.equal(initial, -JOURNAL_SWIPE_ACTIONS_WIDTH_PX);
  assert.equal(journalSwipeOffset(80, initial), -72);
  assert.equal(journalSwipeDestination({ initialState: "open", deltaX: 38, velocityX: 0.1 }), "closed");
});

test("les gestes incomplets reviennent à leur position initiale", () => {
  assert.equal(journalSwipeDestination({ initialState: "closed", deltaX: -25, velocityX: -0.1 }), "closed");
  assert.equal(journalSwipeDestination({ initialState: "open", deltaX: 20, velocityX: 0.1 }), "open");
});

test("un geste rapide ouvre ou ferme même s'il est court", () => {
  assert.equal(journalSwipeDestination({ initialState: "closed", deltaX: -20, velocityX: -0.6 }), "open");
  assert.equal(journalSwipeDestination({ initialState: "open", deltaX: 18, velocityX: 0.6 }), "closed");
});

test("un mouvement vertical reste confié au navigateur", () => {
  assert.equal(journalSwipeAxis(-12, 48), "vertical");
  assert.equal(journalSwipeAxis(10, 9), "vertical");
  assert.equal(journalSwipeAxis(-4, 5), null);
  assert.equal(journalSwipeAxis(-14, 8), "horizontal");
});

test("pointercancel restaure toujours la position stable d'origine", () => {
  assert.equal(journalSwipeDestination({ initialState: "closed", deltaX: -100, velocityX: -1, cancelled: true }), "closed");
  assert.equal(journalSwipeDestination({ initialState: "open", deltaX: 100, velocityX: 1, cancelled: true }), "open");
});

test("l'intégration garantit exclusivité, snap et neutralisation du clic résiduel", () => {
  const source = readFileSync(new URL("../components/journal/JournalFlightList.tsx", import.meta.url), "utf8");
  assert.match(source, /openSwipeFlightId/);
  assert.match(source, /suppressClickRef/);
  assert.match(source, /onPointerCancel/);
  assert.match(source, /releasePointerCapture/);
  assert.match(source, /transform 190ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(source, /prefers-reduced-motion/);
  assert.doesNotMatch(source, /onTouch(Start|Move|End)/);
});
