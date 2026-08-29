import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LIVE_FRESH_MAX_AGE_MS,
  LIVE_STALE_MAX_AGE_MS,
  LiveSequenceGate,
  buildLiveFlightPayload,
  livePositionFreshness,
  liveReconnectDelayMs,
  shouldPublishLivePosition,
  validateLiveFlightPayload,
} from "./liveFlightSharing.ts";
import { createDevelopmentLiveFlightSimulator, createTargetedLiveFlightSimulator, isTargetedLiveFlightSimulator, shouldRequestLocalFlightGeolocationOnMount, simulateLiveFlightScenario, targetedLiveSimulatorUi } from "./liveFlightSimulator.ts";
import { LiveFlightConnectionGuard, LiveFlightRealtimeTransport, LiveShareSessionService, canPublishLiveFlight, liveShareTopic } from "./liveFlightTransport.ts";

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = 1_800_000_000_000;
const liveMigration = readFileSync(new URL("../../supabase/migrations/20260828130000_live_flight_sharing_foundation.sql", import.meta.url), "utf8");
const payload = (overrides = {}) => buildLiveFlightPayload({ sessionId: SESSION_A, sequence: 1, sentAt: NOW, gpsTimestamp: NOW, latitude: 50.68, longitude: 3.08, altitude: 140, groundSpeed: 5, heading: 45, durationSeconds: 60, distanceKm: 0.4, accuracy: 6, ...overrides });

test("le payload versionné complet est accepté", () => {
  const result = validateLiveFlightPayload(payload(), SESSION_A, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.payload.schemaVersion, 1);
});

test("le validateur rejette schéma, session, champs absents et timestamps incohérents", () => {
  assert.equal(validateLiveFlightPayload({ ...payload(), schemaVersion: 2 }, SESSION_A, NOW).ok, false);
  assert.equal(validateLiveFlightPayload(payload(), SESSION_B, NOW).ok, false);
  const { accuracy: _, ...incomplete } = payload();
  assert.equal(validateLiveFlightPayload(incomplete, SESSION_A, NOW).ok, false);
  assert.equal(validateLiveFlightPayload(payload({ sentAt: NOW + 31_000 }), SESSION_A, NOW).ok, false);
});

test("le validateur rejette NaN, Infinity, coordonnées et valeurs négatives", () => {
  for (const invalid of [
    payload({ latitude: 91 }), payload({ longitude: -181 }), payload({ distanceKm: -1 }),
    payload({ groundSpeed: -1 }), payload({ accuracy: -1 }), payload({ heading: 360 }),
    payload({ altitude: Number.NaN }), payload({ durationSeconds: Number.POSITIVE_INFINITY }),
  ]) assert.equal(validateLiveFlightPayload(invalid, SESSION_A, NOW).ok, false);
});

test("la séquence rejette doublons et anciens messages sans confondre deux sessions", () => {
  const gate = new LiveSequenceGate();
  assert.equal(gate.accept(payload({ sequence: 1 })), true);
  assert.equal(gate.accept(payload({ sequence: 1 })), false);
  assert.equal(gate.accept(payload({ sequence: 3 })), true);
  assert.equal(gate.accept(payload({ sequence: 2 })), false);
  assert.equal(gate.accept(payload({ sessionId: SESSION_B, sequence: 1 })), true);
});

test("la fraîcheur applique exactement FRESH, STALE et EXPIRED", () => {
  assert.equal(livePositionFreshness(NOW - LIVE_FRESH_MAX_AGE_MS, NOW), "FRESH");
  assert.equal(livePositionFreshness(NOW - LIVE_FRESH_MAX_AGE_MS - 1, NOW), "STALE");
  assert.equal(livePositionFreshness(NOW - LIVE_STALE_MAX_AGE_MS, NOW), "STALE");
  assert.equal(livePositionFreshness(NOW - LIVE_STALE_MAX_AGE_MS - 1, NOW), "EXPIRED");
});

test("la publication est immédiate puis limitée à 5 s en mouvement et 12 s stable", () => {
  assert.equal(shouldPublishLivePosition({ now: NOW, current: payload(), previous: null }), true);
  const moving = payload({ sequence: 2, sentAt: NOW + 5_000, gpsTimestamp: NOW + 5_000 });
  assert.equal(shouldPublishLivePosition({ now: NOW + 4_999, current: moving, previous: payload() }), false);
  assert.equal(shouldPublishLivePosition({ now: NOW + 5_000, current: moving, previous: payload() }), true);
  const stablePrevious = payload({ groundSpeed: 0 });
  const stable = payload({ sequence: 2, groundSpeed: 0, sentAt: NOW + 12_000, gpsTimestamp: NOW + 12_000 });
  assert.equal(shouldPublishLivePosition({ now: NOW + 11_999, current: stable, previous: stablePrevious }), false);
  assert.equal(shouldPublishLivePosition({ now: NOW + 12_000, current: stable, previous: stablePrevious }), true);
});

test("les préconditions isolent le Live du tracking local", () => {
  const valid = { authenticatedUserId: "a", sessionOwnerId: "a", trackingActive: true, gpsFresh: true, sessionActive: true, sharingEnabled: true, activeRecipientCount: 1 };
  assert.equal(canPublishLiveFlight(valid), true);
  for (const patch of [{ authenticatedUserId: null }, { trackingActive: false }, { gpsFresh: false }, { sessionActive: false }, { sharingEnabled: false }, { activeRecipientCount: 0 }, { authenticatedUserId: "b" }]) assert.equal(canPublishLiveFlight({ ...valid, ...patch }), false);
});

test("le backoff est borné et réinitialisé après connexion", () => {
  assert.deepEqual([0, 1, 2, 3, 8].map(liveReconnectDelayMs), [1_000, 2_000, 5_000, 10_000, 10_000]);
  const guard = new LiveFlightConnectionGuard();
  const generation = guard.activate("a", SESSION_A);
  assert.equal(guard.valid("a", SESSION_A, generation), true);
  assert.equal(guard.disconnected(), 1_000);
  assert.equal(guard.disconnected(), 2_000);
  guard.connected();
  assert.equal(guard.disconnected(), 1_000);
});

test("logout et USER switch invalident immédiatement l'ancienne cible", () => {
  const guard = new LiveFlightConnectionGuard();
  const oldGeneration = guard.activate("a", SESSION_A);
  const nextGeneration = guard.activate("b", SESSION_B);
  assert.equal(guard.valid("a", SESSION_A, oldGeneration), false);
  assert.equal(guard.valid("b", SESSION_B, nextGeneration), true);
  guard.close();
  assert.equal(guard.current(), null);
  assert.equal(guard.valid("b", SESSION_B, nextGeneration), false);
});

function fakeRealtimeClient() {
  const channels = [];
  const removed = [];
  const rpcCalls = [];
  const client = {
    realtime: { setAuth: async () => undefined },
    channel(topic, options) {
      const callbacks = new Map();
      const channel = {
        topic, options,
        on(_type, filter, callback) { callbacks.set(filter.event, callback); return channel; },
        subscribe(callback) { channel.subscription = callback; callback("SUBSCRIBED"); return channel; },
        sent: [],
        send: async (message) => { channel.sent.push(message); return "ok"; },
        emit(event, body) { callbacks.get(event)?.({ payload: body }); },
      };
      channels.push(channel); return channel;
    },
    removeChannel: async (channel) => { removed.push(channel); return "ok"; },
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: name === "start_live_share_session" ? SESSION_A : name === "heartbeat_live_share_session" ? new Date(NOW).toISOString() : null, error: null }; },
  };
  return { client, channels, removed, rpcCalls };
}

test("le transport utilise un canal Broadcast privé et filtre les messages reçus", async () => {
  const fake = fakeRealtimeClient();
  const received = [];
  const transport = new LiveFlightRealtimeTransport(fake.client);
  await transport.connect({ userId: "a", sessionId: SESSION_A, mode: "RECEIVER", onPosition: (value) => received.push(value) });
  assert.equal(fake.channels[0].topic, liveShareTopic(SESSION_A));
  assert.deepEqual(fake.channels[0].options, { config: { private: true, broadcast: { ack: true, self: false } } });
  const receivedAt = Date.now();
  fake.channels[0].emit("position", payload({ sentAt: receivedAt, gpsTimestamp: receivedAt }));
  fake.channels[0].emit("position", payload({ sentAt: receivedAt, gpsTimestamp: receivedAt }));
  fake.channels[0].emit("position", payload({ latitude: 999, sequence: 2, sentAt: receivedAt, gpsTimestamp: receivedAt }));
  assert.equal(received.length, 1);
  await transport.disconnect();
  assert.equal(fake.removed.length, 1);
});

test("un USER switch ferme le canal et ignore les callbacks de l'ancien USER", async () => {
  const fake = fakeRealtimeClient();
  const received = [];
  const transport = new LiveFlightRealtimeTransport(fake.client);
  await transport.connect({ userId: "a", sessionId: SESSION_A, mode: "RECEIVER", onPosition: (value) => received.push(value) });
  const oldChannel = fake.channels[0];
  await transport.connect({ userId: "b", sessionId: SESSION_B, mode: "RECEIVER", onPosition: (value) => received.push(value) });
  oldChannel.emit("position", payload());
  assert.equal(received.length, 0);
  assert.equal(fake.removed.includes(oldChannel), true);
  await transport.disconnect();
});

test("le publisher exige toutes les conditions métier et redemande une position à chaque connexion", async () => {
  const fake = fakeRealtimeClient();
  let ready = 0;
  const transport = new LiveFlightRealtimeTransport(fake.client);
  await transport.connect({ userId: "a", sessionId: SESSION_A, mode: "PUBLISHER", onReadyToPublish: () => { ready += 1; } });
  const freshNow = Date.now();
  const livePayload = payload({ sentAt: freshNow, gpsTimestamp: freshNow });
  const validContext = { trackingActive: true, gpsFresh: true, sessionActive: true, sharingEnabled: true, activeRecipientCount: 1 };
  assert.equal(ready, 1);
  assert.equal(await transport.publish(livePayload, { ...validContext, trackingActive: false }), false);
  assert.equal(await transport.publish(livePayload, validContext), true);
  assert.equal(fake.channels[0].sent.length, 1);
  await transport.disconnect();
});

test("le service de session appelle uniquement les RPC Live dédiées", async () => {
  const fake = fakeRealtimeClient();
  const service = new LiveShareSessionService(fake.client);
  assert.equal(await service.start(null, ["b"]), SESSION_A);
  await service.heartbeat(SESSION_A); await service.addRecipient(SESSION_A, "c"); await service.revokeRecipient(SESSION_A, "b"); await service.stop(SESSION_A);
  assert.deepEqual(fake.rpcCalls.map(({ name }) => name), ["start_live_share_session", "heartbeat_live_share_session", "add_live_share_recipient", "revoke_live_share_recipient", "stop_live_share_session"]);
  assert.equal(fake.rpcCalls.some(({ name }) => /cloud_sync|mutation|flight_track/i.test(name)), false);
});

test("les douze scénarios DEV sont déterministes et couvrent les anomalies", () => {
  const scenarios = ["NORMAL_FLIGHT", "PROGRESSIVE_CLIMB", "PROGRESSIVE_DESCENT", "DIRECTION_CHANGE", "FROZEN_20_SECONDS", "NETWORK_LOSS_OVER_30_SECONDS", "RECONNECTION", "NORMAL_END", "SIMULATED_CRASH", "OUT_OF_ORDER", "DUPLICATES", "INVALID_PAYLOAD"];
  for (const scenario of scenarios) assert.deepEqual(simulateLiveFlightScenario(scenario, SESSION_A, NOW), simulateLiveFlightScenario(scenario, SESSION_A, NOW));
  assert.equal(simulateLiveFlightScenario("NETWORK_LOSS_OVER_30_SECONDS", SESSION_A, NOW).some(({ kind }) => kind === "NETWORK_OFFLINE"), true);
  assert.equal(simulateLiveFlightScenario("NORMAL_END", SESSION_A, NOW).at(-1).kind, "END");
  assert.equal(simulateLiveFlightScenario("SIMULATED_CRASH", SESSION_A, NOW).at(-1).kind, "CRASH");
  assert.equal(validateLiveFlightPayload(simulateLiveFlightScenario("INVALID_PAYLOAD", SESSION_A, NOW)[0].payload, SESSION_A, NOW).ok, false);
});

test("le simulateur refuse toute activation Production", () => {
  assert.throws(() => createDevelopmentLiveFlightSimulator("production"), /LIVE_SIMULATOR_DISABLED/);
  assert.equal(typeof createDevelopmentLiveFlightSimulator("test").run, "function");
});

test("le simulateur ciblé est absent sur une URL normale et activable avec le paramètre explicite", () => {
  assert.equal(isTargetedLiveFlightSimulator(""), false);
  assert.equal(isTargetedLiveFlightSimulator("?cloudSyncTest=targeted"), false);
  assert.throws(() => createTargetedLiveFlightSimulator(""), /LIVE_SIMULATOR_TARGETED_MODE_REQUIRED/);
  assert.equal(isTargetedLiveFlightSimulator("?liveFlightTest=targeted"), true);
  assert.equal(typeof createTargetedLiveFlightSimulator("?liveFlightTest=targeted").run, "function");
  assert.deepEqual(targetedLiveSimulatorUi("", false), { controlVisible: false, panelVisible: false });
  assert.deepEqual(targetedLiveSimulatorUi("?liveFlightTest=targeted", false), { controlVisible: true, panelVisible: false });
  assert.deepEqual(targetedLiveSimulatorUi("?liveFlightTest=targeted", true), { controlVisible: true, panelVisible: true });
});

test("le récepteur ciblé n'exige pas le GPS local tandis que le mode normal conserve la demande", () => {
  assert.equal(shouldRequestLocalFlightGeolocationOnMount("?liveFlightTest=targeted"), false);
  assert.equal(shouldRequestLocalFlightGeolocationOnMount(""), true);
  assert.equal(shouldRequestLocalFlightGeolocationOnMount("?cloudSyncTest=targeted"), true);
  assert.equal(shouldRequestLocalFlightGeolocationOnMount("?liveFlightTest=other"), true);
});

test("le socle ne référence ni Cloud Sync, ni R2, ni FlightMap, ni stockage GPS", () => {
  const sources = ["./liveFlightSharing.ts", "./liveFlightTransport.ts", "./liveFlightSimulator.ts"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(sources, /syncOutbox|cloudSync|FlightMap|flightTrack|R2|IndexedDB|localStorage/);
  assert.doesNotMatch(liveMigration.match(/create table public\.live_share_sessions[\s\S]*?\);/)?.[0] ?? "", /latitude|longitude|altitude|position|gps_/i);
  assert.match(liveMigration, /on realtime\.messages[\s\S]*for select[\s\S]*can_receive_live_share_topic/);
  assert.match(liveMigration, /on realtime\.messages[\s\S]*for insert[\s\S]*can_send_live_share_topic/);
});
