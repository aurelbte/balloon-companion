import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EMPTY_LIVE_SHARING_UI_STATE, liveSharingSummary, shouldResumeLiveSharingAfterReload, stopLiveSharingUi, toggleLiveRecipient } from "./liveFlightUi.ts";

test("activation et arrêt d'un destinataire gardent la réception indépendante", () => {
  const incoming = { ...EMPTY_LIVE_SHARING_UI_STATE, incomingPilotIds: ["charles"] };
  const active = toggleLiveRecipient(incoming, "charles");
  assert.deepEqual(active.recipientIds, ["charles"]);
  assert.deepEqual(active.incomingPilotIds, ["charles"]);
  assert.equal(liveSharingSummary(active), "Partagé avec 1 ami");
  const stopped = toggleLiveRecipient(active, "charles");
  assert.deepEqual(stopped.recipientIds, []);
  assert.deepEqual(stopped.incomingPilotIds, ["charles"]);
});

test("multi-partage calcule uniquement les destinataires sortants", () => {
  const one = toggleLiveRecipient(EMPTY_LIVE_SHARING_UI_STATE, "charles");
  const two = toggleLiveRecipient(one, "jean");
  assert.equal(two.recipientIds.length, 2);
  assert.equal(liveSharingSummary(two), "Partagé avec 2 amis");
});

test("hors réseau et reconnexion ne prétendent jamais diffuser", () => {
  assert.equal(liveSharingSummary({ ...EMPTY_LIVE_SHARING_UI_STATE, recipientIds: ["charles"], connection: "OFFLINE" }), "Hors réseau — partage suspendu");
  assert.equal(liveSharingSummary({ ...EMPTY_LIVE_SHARING_UI_STATE, recipientIds: ["charles"], connection: "RECONNECTING" }), "Reconnexion…");
});

test("arrêt du vol et USER switch vident l'état Live sans toucher au tracking", () => {
  assert.deepEqual(stopLiveSharingUi(), EMPTY_LIVE_SHARING_UI_STATE);
  assert.equal(shouldResumeLiveSharingAfterReload(), false);
  assert.equal("tracking" in stopLiveSharingUi(), false);
});

test("le contrôle Amis est entre vue élargie et Carte et les deux sens sont explicites", () => {
  const controls = readFileSync(new URL("../components/flight/FlightControls.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/flight/LiveSharingPanel.tsx", import.meta.url), "utf8");
  assert.ok(controls.indexOf("onFitProjection") < controls.indexOf("onToggleLiveSharing"));
  assert.ok(controls.lastIndexOf("onToggleLiveSharing") < controls.lastIndexOf("onToggleMapOptions"));
  assert.match(panel, /Partager mon vol/);
  assert.match(panel, /Arrêter mon partage/);
  assert.match(panel, /Partage son vol avec moi/);
  assert.match(panel, /Aucun ami disponible/);
});
