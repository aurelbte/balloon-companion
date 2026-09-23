import test from "node:test";
import assert from "node:assert/strict";
import { recoverMissingFlightTrackDownloads } from "./flightTrackDownloadRecovery.ts";
import { MemoryFlightTrackQueueStorage } from "./flightTrackQueue.ts";
import { scopedBusinessStorageKey } from "./auth/dataScopeRuntime.ts";

const scope = "USER:user-a";
const failed = (extra = {}) => ({ jobId: "download-a", scope, userId: "user-a", flightId: "flight-a", operation: "DOWNLOAD", generation: 1, attempts: 101, createdAt: "2026-09-23T10:00:00.000Z", updatedAt: "2026-09-23T10:15:00.000Z", status: "FAILED", lastErrorCode: "LOCAL_FLIGHT_METADATA_NOT_FOUND", lastErrorCategory: "LOCAL", ...extra });
const emptyLocal = () => ({ flight: null, rawRecordPresent: false, activeFlightWithSameId: false, matchingIntentIds: [] });
const storage = () => ({ length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {}, clear() {} });

function fixture({ local = emptyLocal(), mutations = [], cloud = "ABSENT", onCloud, businessStorage = storage() } = {}) {
  const queue = new MemoryFlightTrackQueueStorage(new Map([["download-a", failed()], ["other", failed({ jobId: "other", flightId: "flight-b", lastErrorCode: "NETWORK" })]]));
  let currentScope = scope, generation = 3;
  const input = { scope, storage: businessStorage, queue, outbox: { list: async () => structuredClone(mutations) }, inspectLocal: async () => structuredClone(local), restoreFromCloud: async () => { await onCloud?.(queue); return cloud; }, getScope: () => currentScope, getGeneration: () => generation };
  return { queue, input, switchScope: () => { currentScope = "USER:user-b"; generation += 1; } };
}

test("un vol Cloud récupérable restaure les métadonnées et rend le même job rejouable", async () => {
  const context = fixture({ cloud: "RESTORED" });
  assert.deepEqual(await recoverMissingFlightTrackDownloads(context.input), { restored: 1, removed: 0 });
  const job = (await context.queue.list()).find(({ jobId }) => jobId === "download-a");
  assert.equal(job.status, "PENDING");
  assert.equal(job.lastErrorCode, undefined);
  assert.equal((await context.queue.list()).some(({ jobId }) => jobId === "other"), true);
});

test("un véritable orphelin retire seulement son job DOWNLOAD", async () => {
  const context = fixture();
  assert.deepEqual(await recoverMissingFlightTrackDownloads(context.input), { restored: 0, removed: 1 });
  assert.deepEqual((await context.queue.list()).map(({ jobId }) => jobId), ["other"]);
});

test("mutation, snapshot, intention ou session empêchent le nettoyage", async (t) => {
  const intentStorage = (() => {
    const values = new Map([[scopedBusinessStorageKey(scope, "balloon-companion-flight-completion-v1"), JSON.stringify({ __balloonPendingSync: [{ mutationId: "intent", entityType: "flight", entityId: "flight-a", operation: "UPSERT" }] })]]);
    return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), clear: () => values.clear() };
  })();
  const cases = [
    ["mutation", { mutations: [{ mutationId: "m", entityType: "flight", entityId: "flight-a", operation: "UPSERT", payloadSnapshot: null }] }],
    ["snapshot", { mutations: [{ mutationId: "m", entityType: "flight", entityId: "flight-a", operation: "UPSERT", payloadSnapshot: { payload: {} } }] }],
    ["intention", { local: { ...emptyLocal(), matchingIntentIds: ["i"] } }],
    ["intention C2 localStorage", { businessStorage: intentStorage }],
    ["session", { local: { ...emptyLocal(), activeFlightWithSameId: true } }],
    ["brut invalide", { local: { ...emptyLocal(), rawRecordPresent: true } }],
  ];
  for (const [name, options] of cases) await t.test(name, async () => {
    const context = fixture(options);
    assert.deepEqual(await recoverMissingFlightTrackDownloads(context.input), { restored: 0, removed: 0 });
    assert.equal((await context.queue.list()).some(({ jobId }) => jobId === "download-a"), true);
  });
});

test("changement de scope ou du job refuse le nettoyage", async (t) => {
  await t.test("scope", async () => {
    const context = fixture({ onCloud: async () => context.switchScope() });
    assert.deepEqual(await recoverMissingFlightTrackDownloads(context.input), { restored: 0, removed: 0 });
  });
  await t.test("job", async () => {
    const context = fixture({ onCloud: async queue => queue.put({ ...failed(), attempts: 102 }) });
    assert.deepEqual(await recoverMissingFlightTrackDownloads(context.input), { restored: 0, removed: 0 });
    assert.equal((await context.queue.list()).find(({ jobId }) => jobId === "download-a").attempts, 102);
  });
});

test("le drain ne retente pas aveuglément LOCAL_FLIGHT_METADATA_NOT_FOUND", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./flightTrackQueue.ts", import.meta.url), "utf8"));
  assert.match(source, /job\.operation === "DOWNLOAD" && job\.lastErrorCode === "LOCAL_FLIGHT_METADATA_NOT_FOUND"/);
});
