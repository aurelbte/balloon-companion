import assert from "node:assert/strict";
import test from "node:test";
import { LiveFlightRuntime } from "./liveFlightRuntime.ts";
import { livePublisherScenarioAction, simulateLiveFlightScenario } from "./liveFlightSimulator.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function backend() {
  const sessions = new Map();
  const channels = new Map();
  const calls = [];
  let nextSession = S1;
  const client = (userId) => ({
    realtime: { setAuth: async () => undefined },
    rpc: async (name, args = {}) => {
      calls.push({ userId, name, args });
      if (name === "start_live_share_session") { const id = nextSession; sessions.set(id, { ownerId: userId, recipients: [...args.p_recipient_ids], active: true }); return { data: id, error: null }; }
      if (name === "add_live_share_recipient") { sessions.get(args.p_session_id).recipients.push(args.p_recipient_id); return { data: null, error: null }; }
      if (name === "heartbeat_live_share_session") return { data: new Date().toISOString(), error: null };
      if (name === "stop_live_share_session") { const session = sessions.get(args.p_session_id); if (session) session.active = false; return { data: null, error: null }; }
      if (name === "rotate_live_share_after_recipient_revocation") {
        const old = sessions.get(args.p_session_id); old.active = false;
        const remaining = old.recipients.filter((id) => id !== args.p_recipient_id);
        if (!remaining.length) return { data: null, error: null };
        nextSession = S2; sessions.set(S2, { ownerId: userId, recipients: remaining, active: true }); return { data: S2, error: null };
      }
      if (name === "discover_live_share_sessions") return { data: [...sessions].flatMap(([id, session]) => session.active && session.recipients.includes(userId) ? [{ session_id: id, owner_id: session.ownerId, display_name: session.ownerId === A ? "Alice Aéro" : "Pilote", handle: "alice.aero", expires_at: new Date(Date.now() + 90_000).toISOString() }] : []), error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    channel(topic) {
      const listeners = new Map();
      const channel = {
        topic,
        on(_kind, filter, callback) { listeners.set(filter.event, callback); return channel; },
        subscribe(callback) { if (!channels.has(topic)) channels.set(topic, new Set()); channels.get(topic).add(channel); callback("SUBSCRIBED"); return channel; },
        async send(message) { for (const target of channels.get(topic) ?? []) if (target !== channel) target.emit(message.event, message.payload); return "ok"; },
        emit(event, payload) { listeners.get(event)?.({ payload }); },
      };
      return channel;
    },
    removeChannel: async (channel) => { channels.get(channel.topic)?.delete(channel); return "ok"; },
  });
  return { client, calls, sessions };
}

const source = () => ({ latitude: 50.6, longitude: 3.1, altitude: 620, groundSpeed: 4, heading: 245, durationSeconds: 120, distanceKm: 1.2, accuracy: 5, gpsTimestamp: Date.now(), fresh: true });

test("A partage réellement avec B, B sans source GPS locale découvre le canal et reçoit le payload validé", async () => {
  const server = backend();
  let pilotsB = [];
  const noop = { onOutgoing() {}, onIncomingPilots() {}, onIncomingOwners() {} };
  const runtimeA = new LiveFlightRuntime(server.client(A), noop);
  const runtimeB = new LiveFlightRuntime(server.client(B), { ...noop, onIncomingPilots(pilots) { pilotsB = pilots; } });
  await runtimeA.start(A); await runtimeB.start(B);
  await runtimeA.addRecipient(B, "flight-a");
  await runtimeB.refreshIncoming();
  assert.equal(server.calls.some(({ userId, name }) => userId === B && name === "start_live_share_session"), false);
  assert.equal(await runtimeA.publishSource(source(), true), true);
  assert.equal(pilotsB.length, 1);
  assert.equal(pilotsB[0].pilotId, A);
  assert.equal(pilotsB[0].current.altitude, 620);
  await runtimeA.close(); await runtimeB.close();
});

test("une session sert B+C puis la révocation de B effectue une rotation et conserve C", async () => {
  const server = backend();
  const snapshots = [];
  const runtimeA = new LiveFlightRuntime(server.client(A), { onOutgoing(value) { snapshots.push(value); }, onIncomingPilots() {}, onIncomingOwners() {} });
  await runtimeA.start(A);
  await runtimeA.addRecipient(B, null);
  await runtimeA.addRecipient(C, null);
  assert.equal(server.calls.filter(({ name }) => name === "start_live_share_session").length, 1);
  assert.equal(server.calls.filter(({ name }) => name === "add_live_share_recipient").length, 1);
  await runtimeA.removeRecipient(B);
  assert.deepEqual(snapshots.at(-1).recipientIds, [C]);
  assert.equal(server.sessions.get(S1).active, false);
  assert.deepEqual(server.sessions.get(S2).recipients, [C]);
  await runtimeA.removeRecipient(C);
  assert.deepEqual(snapshots.at(-1).recipientIds, []);
  await runtimeA.close();
});

test("fermeture USER stoppe publication, canaux et ne reprend rien au reload", async () => {
  const server = backend();
  const runtime = new LiveFlightRuntime(server.client(A), { onOutgoing() {}, onIncomingPilots() {}, onIncomingOwners() {} });
  await runtime.start(A); await runtime.addRecipient(B, null); runtime.stopOutgoingBestEffort();
  assert.equal(await runtime.publishSource(source(), true), false);
  await runtime.close();
});

test("la fin explicite retire immédiatement le pilote distant sans attendre le TTL", async () => {
  const server = backend();
  let pilotsB = [];
  const noop = { onOutgoing() {}, onIncomingPilots() {}, onIncomingOwners() {} };
  const runtimeA = new LiveFlightRuntime(server.client(A), noop);
  const runtimeB = new LiveFlightRuntime(server.client(B), { ...noop, onIncomingPilots(pilots) { pilotsB = pilots; } });
  await runtimeA.start(A); await runtimeB.start(B);
  await runtimeA.addRecipient(B, null); await runtimeB.refreshIncoming();
  await runtimeA.publishSource(source(), true);
  assert.equal(pilotsB.length, 1);
  runtimeA.stopOutgoingBestEffort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pilotsB.length, 0);
  await runtimeA.close(); await runtimeB.close();
});

test("NORMAL_END parcourt le publisher réel puis retire immédiatement le récepteur", async () => {
  const server = backend();
  let pilotsB = [];
  const noop = { onOutgoing() {}, onIncomingPilots() {}, onIncomingOwners() {} };
  const runtimeA = new LiveFlightRuntime(server.client(A), noop);
  const runtimeB = new LiveFlightRuntime(server.client(B), { ...noop, onIncomingPilots(pilots) { pilotsB = pilots; } });
  await runtimeA.start(A); await runtimeB.start(B);
  await runtimeA.addRecipient(B, null); await runtimeB.refreshIncoming();
  for (const event of simulateLiveFlightScenario("NORMAL_END", S1, Date.now())) {
    const action = livePublisherScenarioAction(event);
    if (action === "PUBLISH_POSITION" && event.kind === "POSITION") {
      const payload = event.payload;
      await runtimeA.publishSource({ latitude: payload.latitude, longitude: payload.longitude, altitude: payload.altitude, groundSpeed: payload.groundSpeed, heading: payload.heading, durationSeconds: payload.durationSeconds, distanceKm: payload.distanceKm, accuracy: payload.accuracy, gpsTimestamp: Date.now(), fresh: true }, true);
    } else if (action === "END_EXPLICITLY") runtimeA.stopOutgoingBestEffort();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(pilotsB.length, 0);
  await runtimeA.close(); await runtimeB.close();
});
