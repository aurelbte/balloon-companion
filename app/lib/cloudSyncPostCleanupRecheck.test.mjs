import test from "node:test";
import assert from "node:assert/strict";
import { CloudSyncRuntimeController } from "./cloudSyncRuntimeController.ts";
import { requestCloudSyncPostCleanupRecheck } from "./cloudSyncPostCleanupRecheck.ts";

function fixture(states) {
  let scope = "USER:A", generation = 1, pushes = 0;
  const controller = new CloudSyncRuntimeController({
    isOnline: () => true,
    bootstrap: async () => ({ state: "SUCCESS", resumable: false }),
    push: async () => ({ state: states[pushes++] ?? "COMPLETED" }),
  });
  controller.setUser("A");
  const request = () => requestCloudSyncPostCleanupRecheck({ scope: "USER:A", generation: 1, getScope: () => scope, getGeneration: () => generation, synchronize: () => controller.synchronizeNow() });
  return { controller, request, pushes: () => pushes, change: () => { scope = "USER:B"; generation += 1; } };
}

test("dernier job nettoyé relance un passage réel qui remplace STOPPED_ERROR par COMPLETED", async () => {
  const ctx = fixture(["STOPPED_ERROR", "COMPLETED"]);
  await ctx.controller.whenIdle();
  assert.equal(ctx.controller.inspect().lastPushState, "STOPPED_ERROR");
  await ctx.request();
  assert.equal(ctx.controller.inspect().lastPushState, "COMPLETED");
  assert.equal(ctx.controller.inspect().lastError, null);
});

test("un nouvel échec reste STOPPED_ERROR avec l'erreur produite par le passage réel", async () => {
  const ctx = fixture(["STOPPED_ERROR", "STOPPED_ERROR"]);
  await ctx.controller.whenIdle(); await ctx.request();
  assert.equal(ctx.controller.inspect().lastPushState, "STOPPED_ERROR");
  assert.equal(ctx.controller.inspect().lastError.code, "PUSH_STOPPED_ERROR");
});

test("scope ou génération changé annule la relance", async () => {
  const ctx = fixture(["STOPPED_ERROR", "COMPLETED"]);
  await ctx.controller.whenIdle(); ctx.change(); await ctx.request();
  assert.equal(ctx.pushes(), 1);
  assert.equal(ctx.controller.inspect().lastPushState, "STOPPED_ERROR");
});

test("deux demandes pendant le même passage partagent une seule relance", async () => {
  const ctx = fixture(["STOPPED_ERROR", "COMPLETED"]);
  await ctx.controller.whenIdle();
  const first = ctx.request(), second = ctx.request();
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(ctx.pushes(), 2);
});
