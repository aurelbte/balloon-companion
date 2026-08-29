import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveFlightPayload } from "./liveFlightSharing.ts";
import {
  SharedPilotMapStore,
  SHARED_PILOT_MODAL_LAYOUT,
  SHARED_PILOT_REOPEN_GUARD_MS,
  canOpenSharedPilot,
  getSharedPilotSelectionAfterAction,
  interpolateLiveCoordinate,
  relativeLiveAltitudeMeters,
  sharedPilotInitials,
  sharedPilotVisibility,
} from "./liveFlightMap.ts";

const NOW = 1_800_000_000_000;
const CHARLES = { pilotId: "charles", displayName: "Charles Grelin", sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const JEAN = { pilotId: "jean", displayName: "Jean Dupont", sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const payload = (sessionId = CHARLES.sessionId, overrides = {}) => buildLiveFlightPayload({ sessionId, sequence: 1, sentAt: NOW, gpsTimestamp: NOW, latitude: 50, longitude: 3, altitude: 620, groundSpeed: 4, heading: 350, durationSeconds: 2_520, distanceKm: 8.4, accuracy: 5, ...overrides });

test("les initiales utilisent le prénom puis le nom", () => {
  assert.equal(sharedPilotInitials("Charles Grelin"), "CG");
  assert.equal(sharedPilotInitials("Jean Dupont"), "JD");
  assert.equal(sharedPilotInitials("  Élodie   du Pont  "), "ÉP");
});

test("une seule fiche pilote est ouverte et fermeture/carte la ferment immédiatement", () => {
  assert.equal(getSharedPilotSelectionAfterAction(null, "OPEN", "charles"), "charles");
  assert.equal(getSharedPilotSelectionAfterAction("charles", "OPEN", "jean"), "jean");
  assert.equal(getSharedPilotSelectionAfterAction("jean", "CLOSE"), null);
  assert.equal(getSharedPilotSelectionAfterAction("charles", "MAP_PRESS"), null);
});

test("la modal est centrée au-dessus de MapLibre avec une cible tactile iPhone", () => {
  assert.equal(SHARED_PILOT_MODAL_LAYOUT.centered, true);
  assert.ok(SHARED_PILOT_MODAL_LAYOUT.zIndex >= 1_000);
  assert.ok(SHARED_PILOT_MODAL_LAYOUT.closeTouchTargetPx >= 44);
  assert.ok(SHARED_PILOT_MODAL_LAYOUT.horizontalMarginPx > 0);
});

test("le geste Safari de fermeture ne peut pas rouvrir immédiatement le marqueur dessous", () => {
  const dismissedAt = NOW;
  const suppressedUntil = dismissedAt + SHARED_PILOT_REOPEN_GUARD_MS;
  assert.equal(canOpenSharedPilot(suppressedUntil, dismissedAt), false);
  assert.equal(canOpenSharedPilot(suppressedUntil, suppressedUntil - 1), false);
  assert.equal(canOpenSharedPilot(suppressedUntil, suppressedUntil), true);
});

test("l'interpolation est bornée et suit le plus court changement de cap", () => {
  const from = payload(CHARLES.sessionId, { latitude: 50, longitude: 3, heading: 350 });
  const to = payload(CHARLES.sessionId, { latitude: 52, longitude: 5, heading: 10 });
  assert.deepEqual(interpolateLiveCoordinate(from, to, 0.5), { latitude: 51, longitude: 4, heading: 0 });
  assert.equal(interpolateLiveCoordinate(from, to, 4).latitude, 52);
  assert.equal(interpolateLiveCoordinate(from, to, -2).latitude, 50);
});

test("FRESH est visible, STALE visible et atténué, EXPIRED masqué", () => {
  assert.deepEqual(sharedPilotVisibility(payload(), NOW), { freshness: "FRESH", visible: true, dimmed: false });
  assert.deepEqual(sharedPilotVisibility(payload(), NOW + 15_001), { freshness: "STALE", visible: true, dimmed: true });
  assert.deepEqual(sharedPilotVisibility(payload(), NOW + 30_001), { freshness: "EXPIRED", visible: false, dimmed: false });
});

test("l'altitude relative est factuelle, signée et réservée aux données fraîches", () => {
  assert.equal(relativeLiveAltitudeMeters(payload(), 440, true, NOW), 180);
  assert.equal(relativeLiveAltitudeMeters(payload(), 700, true, NOW), -80);
  assert.equal(relativeLiveAltitudeMeters(payload(), 620, true, NOW), 0);
  assert.equal(relativeLiveAltitudeMeters(payload(), 440, false, NOW), null);
  assert.equal(relativeLiveAltitudeMeters(payload(), 440, true, NOW + 15_001), null);
  assert.equal(relativeLiveAltitudeMeters(payload(CHARLES.sessionId, { altitude: null }), 440, true, NOW), null);
});

test("plusieurs pilotes restent indépendants et la mise à jour d'un pilote ne déplace pas l'autre", () => {
  const store = new SharedPilotMapStore();
  assert.equal(store.accept(CHARLES, payload(), NOW), true);
  assert.equal(store.accept(JEAN, payload(JEAN.sessionId, { latitude: 51 }), NOW), true);
  const jeanBefore = store.list(NOW).find((entry) => entry.pilotId === JEAN.pilotId);
  assert.equal(store.accept(CHARLES, payload(CHARLES.sessionId, { sequence: 2, longitude: 4 }), NOW), true);
  const entries = store.list(NOW);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.pilotId === CHARLES.pilotId)?.current.longitude, 4);
  assert.equal(entries.find((entry) => entry.pilotId === JEAN.pilotId), jeanBefore);
});

test("fin de partage et USER switch retirent immédiatement les pilotes", () => {
  const store = new SharedPilotMapStore();
  store.accept(CHARLES, payload(), NOW);
  store.accept(JEAN, payload(JEAN.sessionId), NOW);
  store.removeSession(CHARLES.sessionId);
  assert.deepEqual(store.list(NOW).map((entry) => entry.pilotId), ["jean"]);
  store.clearForUserSwitch();
  assert.equal(store.list(NOW).length, 0);
});

test("un payload rejeté ou expiré ne crée jamais de marqueur", () => {
  const store = new SharedPilotMapStore();
  assert.equal(store.accept(CHARLES, { ...payload(), latitude: 999 }, NOW), false);
  assert.equal(store.accept(CHARLES, payload(CHARLES.sessionId, { gpsTimestamp: NOW - 30_001, sentAt: NOW - 30_001 }), NOW), false);
  assert.equal(store.list(NOW).length, 0);
});
