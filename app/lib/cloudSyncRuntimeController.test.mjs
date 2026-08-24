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
  ctx.controller.resumeBootstrap();
  await ctx.controller.whenIdle();
  assert.deepEqual(ctx.bootstraps, ["A", "A"]);
  assert.deepEqual(ctx.pushes, ["A"]);
});

test("une mutation pendant le bootstrap est mise en attente sans concurrence", async () => {
  let release;
  const order = [];
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async () => { order.push("bootstrap:start"); await new Promise((resolve) => { release = resolve; }); order.push("bootstrap:end"); return { state: "SUCCESS", resumable: false }; },
    push: async () => { order.push("push"); },
  });
  controller.setUser("A");
  await Promise.resolve();
  controller.notifyLocalMutation();
  release();
  await controller.whenIdle();
  assert.deepEqual(order, ["bootstrap:start", "bootstrap:end", "push"]);
});
