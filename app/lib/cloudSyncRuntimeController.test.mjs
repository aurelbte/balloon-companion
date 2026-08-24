import assert from "node:assert/strict";
import test from "node:test";
import { CloudSyncRuntimeController } from "./cloudSyncRuntimeController.ts";

function fixture(reports = [{ state: "SUCCESS", resumable: false }]) {
  let online = true;
  const bootstraps = [], pushes = [];
  const controller = new CloudSyncRuntimeController({
    isOnline: () => online,
    bootstrap: async (userId) => { bootstraps.push(userId); return reports.shift() ?? { state: "SUCCESS", resumable: false }; },
    push: async (userId) => { pushes.push(userId); },
  });
  return { controller, bootstraps, pushes, setOnline: (value) => { online = value; } };
}

test("un double déclenchement du même USER ne lance qu'un bootstrap et un PUSH sérialisé", async () => {
  const ctx = fixture();
  ctx.controller.setUser("A");
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.bootstraps, ["A"]);
  assert.deepEqual(ctx.pushes, ["A"]);
});

test("USER A vers USER B invalide la cible précédente avant tout PUSH", async () => {
  let release;
  const bootstraps = [], pushes = [];
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async (userId) => { bootstraps.push(userId); if (userId === "A") await new Promise((resolve) => { release = resolve; }); return { state: "SUCCESS", resumable: false }; },
    push: async (userId) => { pushes.push(userId); },
  });
  controller.setUser("A");
  await Promise.resolve();
  controller.setUser("B");
  release();
  await controller.whenIdle();
  assert.deepEqual(bootstraps, ["A", "B"]);
  assert.deepEqual(pushes, ["B"]);
});

test("un logout pendant le bootstrap interdit le PUSH", async () => {
  let release;
  const pushes = [];
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async () => { await new Promise((resolve) => { release = resolve; }); return { state: "SUCCESS", resumable: false }; },
    push: async (userId) => { pushes.push(userId); },
  });
  controller.setUser("A");
  await Promise.resolve();
  controller.setUser(null);
  release();
  await controller.whenIdle();
  assert.deepEqual(pushes, []);
});

test("offline ne lance rien et le retour online déclenche bootstrap puis PUSH", async () => {
  const ctx = fixture();
  ctx.setOnline(false);
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.bootstraps, []);
  ctx.setOnline(true);
  ctx.controller.notifyOnline();
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.bootstraps, ["A"]);
  assert.deepEqual(ctx.pushes, ["A"]);
});

test("PARTIAL conserve le PUSH en attente et une reprise réussie l'autorise", async () => {
  const ctx = fixture([{ state: "PARTIAL", resumable: true }, { state: "SUCCESS", resumable: false }]);
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.pushes, []);
  assert.equal(ctx.controller.inspect().lastPushAuthorized, false);
  assert.equal(ctx.controller.inspect().lastPushRefusalReason, "BOOTSTRAP_PARTIAL");
  ctx.controller.resumeBootstrap();
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.bootstraps, ["A", "A"]);
  assert.deepEqual(ctx.pushes, ["A"]);
});

for (const scenario of [
  { label: "PARTIAL avec pending local", state: "PARTIAL" },
  { label: "PARTIAL avec conflit", state: "PARTIAL" },
  { label: "BLOCKED", state: "BLOCKED" },
  { label: "STOPPED_ERROR", state: "STOPPED_ERROR" },
  { label: "OFFLINE retourné par le bootstrap", state: "OFFLINE" },
]) {
  test(`${scenario.label} n'autorise jamais le drain automatique`, async () => {
    const pendingOutbox = [{ mutationId: "existing-user-mutation", attempts: 0 }];
    const snapshot = structuredClone(pendingOutbox);
    const ctx = fixture([{ state: scenario.state, resumable: true }]);
    ctx.controller.setUser("A");
    await ctx.controller.whenIdle();
    assert.deepEqual(ctx.pushes, []);
    assert.deepEqual(pendingOutbox, snapshot);
  });
}

test("SUCCESS avec outbox préexistante autorise un drain unique après la fin du bootstrap", async () => {
  const order = [];
  const outbox = [{ mutationId: "valid-pending", entityType: "flight" }];
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async () => { order.push("bootstrap"); return { state: "SUCCESS", resumable: false }; },
    push: async () => { order.push("push"); assert.deepEqual(outbox, [{ mutationId: "valid-pending", entityType: "flight" }]); },
  });
  controller.setUser("A");
  controller.notifyLocalMutation();
  await controller.whenIdle();
  assert.deepEqual(order, ["bootstrap", "push"]);
});

test("un enqueue après SUCCESS déclenche un PUSH sans nouveau bootstrap", async () => {
  const ctx = fixture();
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  ctx.controller.notifyLocalMutation();
  ctx.controller.notifyLocalMutation();
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.bootstraps, ["A"]);
  assert.deepEqual(ctx.pushes, ["A", "A", "A"]);
});

test("une perte réseau pendant le bootstrap interdit le drain malgré SUCCESS", async () => {
  let online = true;
  const pushes = [];
  const controller = new CloudSyncRuntimeController({
    isOnline: () => online,
    bootstrap: async () => { online = false; return { state: "SUCCESS", resumable: false }; },
    push: async (userId) => { pushes.push(userId); },
  });
  controller.setUser("A");
  await controller.whenIdle();
  assert.deepEqual(pushes, []);
});

test("le snapshot observe SUCCESS, ONLINE, déduplication et PUSH sans donnée métier", async () => {
  const ctx = fixture();
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  ctx.controller.notifyOnline();
  ctx.controller.notifyOnline();
  await ctx.controller.whenIdle();
  const snapshot = ctx.controller.inspect();
  assert.equal(snapshot.scope, "USER:A");
  assert.equal(snapshot.lastTrigger, "ONLINE");
  assert.equal(snapshot.lastBootstrapState, "SUCCESS");
  assert.equal(snapshot.lastPushAuthorized, true);
  assert.equal(snapshot.lastPushExecuted, false);
  assert.ok(snapshot.deduplicatedRequests >= 1);
  assert.ok(snapshot.history.some(({ type }) => type === "TRIGGER_ONLINE"));
  assert.ok(snapshot.history.some(({ type }) => type === "PUSH_COMPLETED"));
  assert.equal(JSON.stringify(snapshot).includes("payload"), false);
});

test("STOPPED_ERROR sanitise le diagnostic et refuse le PUSH", async () => {
  const token = "eyJheader.payload.signature";
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async () => { throw new Error(`failure ${token}`); },
    push: async () => { assert.fail("PUSH interdit"); },
  });
  controller.setUser("A");
  await controller.whenIdle();
  const snapshot = controller.inspect();
  assert.equal(snapshot.lastBootstrapState, "STOPPED_ERROR");
  assert.equal(snapshot.lastPushAuthorized, false);
  assert.equal(snapshot.lastError.message.includes(token), false);
  assert.match(snapshot.lastError.message, /\[REDACTED\]/);
});

test("USER switch et logout sont observables sans résultat tardif de l'ancien USER", async () => {
  let release;
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async (userId) => { if (userId === "A") await new Promise((resolve) => { release = resolve; }); return { state: "SUCCESS", resumable: false }; },
    push: async () => {},
  });
  controller.setUser("A");
  await Promise.resolve();
  controller.setUser("B");
  release();
  await controller.whenIdle();
  controller.setUser(null);
  const snapshot = controller.inspect();
  assert.equal(snapshot.userId, null);
  assert.ok(snapshot.cancelledExecutions >= 1);
  assert.ok(snapshot.history.some(({ type }) => type === "USER_SWITCH"));
  assert.ok(snapshot.history.some(({ type }) => type === "LOGOUT"));
});

test("une mutation pendant un bootstrap finalement BLOCKED reste intacte et ne déclenche aucun drain", async () => {
  let release;
  const order = [];
  const outbox = [{ mutationId: "created-during-bootstrap" }];
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async () => { order.push("bootstrap:start"); await new Promise((resolve) => { release = resolve; }); order.push("bootstrap:end"); return { state: "BLOCKED", resumable: true }; },
    push: async () => { order.push("push"); },
  });
  controller.setUser("A");
  await Promise.resolve();
  controller.notifyLocalMutation();
  release();
  await controller.whenIdle();
  assert.deepEqual(order, ["bootstrap:start", "bootstrap:end"]);
  assert.deepEqual(outbox, [{ mutationId: "created-during-bootstrap" }]);
});

function retryFixture() {
  let online = true, nowMs = Date.parse("2026-08-24T10:00:00.000Z"), next = "2026-08-24T10:01:00.000Z";
  const timers = new Map(), pushes = [];
  let timerId = 0;
  const controller = new CloudSyncRuntimeController({
    isOnline: () => online,
    bootstrap: async () => ({ state: "SUCCESS", resumable: false }),
    push: async () => { pushes.push("push"); if (next && nowMs >= Date.parse(next)) next = null; },
    getNextEligibleRetryAt: async () => next,
    nowMs: () => nowMs,
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  return { controller, timers, pushes, setNext: (value) => { next = value; }, setOnline: (value) => { online = value; }, setNow: (value) => { nowMs = Date.parse(value); } };
}

test("une mutation retryable programme un timer unique et une échéance plus proche le remplace", async () => {
  const ctx = retryFixture();
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  assert.equal(ctx.timers.size, 1);
  assert.equal(ctx.controller.inspect().nextEligibleRetryAt, "2026-08-24T10:01:00.000Z");
  ctx.setNext("2026-08-24T10:00:30.000Z");
  await ctx.controller.notifyVisible();
  assert.equal(ctx.timers.size, 1);
  assert.equal(ctx.controller.inspect().lastTrigger, "VISIBILITY");
  assert.equal(ctx.controller.inspect().nextEligibleRetryAt, "2026-08-24T10:00:30.000Z");
});

test("le timer dû déclenche un PUSH sérialisé puis annule le réveil", async () => {
  const ctx = retryFixture();
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  const timer = [...ctx.timers.values()][0];
  ctx.setNow("2026-08-24T10:01:00.000Z");
  timer.callback();
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.pushes, ["push", "push"]);
  assert.equal(ctx.controller.inspect().retryTimerScheduled, false);
  assert.equal(ctx.controller.inspect().lastTrigger, "RETRY_TIMER");
});

test("un timer expiré offline attend ONLINE sans tentative ni concurrence", async () => {
  const ctx = retryFixture();
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  const timer = [...ctx.timers.values()][0];
  ctx.setOnline(false);
  ctx.setNow("2026-08-24T10:01:00.000Z");
  timer.callback();
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.pushes, ["push"]);
  ctx.setOnline(true);
  ctx.controller.notifyOnline();
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.pushes, ["push", "push"]);
});

test("une outbox sans retry annule le timer et le logout l'annule aussi", async () => {
  const ctx = retryFixture();
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  assert.equal(ctx.controller.inspect().retryTimerScheduled, true);
  ctx.setNext(null);
  await ctx.controller.notifyVisible();
  assert.equal(ctx.controller.inspect().retryTimerScheduled, false);

  ctx.setNext("2026-08-24T10:02:00.000Z");
  await ctx.controller.notifyVisible();
  assert.equal(ctx.controller.inspect().retryTimerForUserId, "A");
  ctx.controller.setUser(null);
  assert.equal(ctx.controller.inspect().retryTimerScheduled, false);
  assert.equal(ctx.controller.inspect().retryTimerForUserId, null);
});

test("un USER switch invalide l'ancien timer avant de cibler le nouveau USER", async () => {
  const ctx = retryFixture();
  ctx.controller.setUser("A");
  await ctx.controller.whenIdle();
  const oldTimer = [...ctx.timers.values()][0];
  ctx.controller.setUser("B");
  await ctx.controller.whenIdle();
  assert.equal(ctx.controller.inspect().retryTimerForUserId, "B");
  ctx.setNow("2026-08-24T10:01:00.000Z");
  oldTimer.callback();
  await ctx.controller.whenIdle();
  assert.equal(ctx.controller.inspect().userId, "B");
  assert.deepEqual(ctx.pushes, ["push", "push"]);
});
