import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { setRuntimeAuthSnapshot } from "./auth/dataScopeRuntime.ts";
import {
  drainFlightTrackQueue,
  enqueueFlightTrackJob,
  flightTrackBackoffMs,
  MemoryFlightTrackQueueStorage,
  nextFlightTrackRetryAt,
} from "./flightTrackQueue.ts";

const scope = "USER:user-a";
const signedIn = (id = "user-a") => setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id, email: `${id}@example.test`, firstName: "", lastName: "" } });
afterEach(() => setRuntimeAuthSnapshot({ state: "UNKNOWN", user: null }));

test("queue durable logique coalesce upload et DELETE remplace les jobs liés", async () => {
  signedIn();
  const storage = new MemoryFlightTrackQueueStorage();
  const first = await enqueueFlightTrackJob(storage, { scope, flightId: "flight-a", operation: "UPLOAD" });
  const duplicate = await enqueueFlightTrackJob(storage, { scope, flightId: "flight-a", operation: "UPLOAD" });
  assert.equal(duplicate.jobId, first.jobId);
  await enqueueFlightTrackJob(storage, { scope, flightId: "flight-a", operation: "DELETE" });
  assert.deepEqual((await storage.list()).map(({ operation }) => operation), ["DELETE"]);
});

test("backoff exact et durable: 5s, 15s, 45s, 2m, 5m, 15m", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(flightTrackBackoffMs), [5_000, 15_000, 45_000, 120_000, 300_000, 900_000, 900_000]);
});

test("erreur réseau conserve le job, puis retry réussi le retire", async () => {
  signedIn();
  const storage = new MemoryFlightTrackQueueStorage();
  await enqueueFlightTrackJob(storage, { scope, flightId: "flight-a", operation: "UPLOAD" }, "2026-08-26T10:00:00.000Z");
  let fail = true;
  const transport = { upload: async () => { if (fail) throw new Error("NETWORK_TIMEOUT"); }, download: async () => {}, cleanup: async () => {} };
  const failed = await drainFlightTrackQueue({ scope, storage, transport, online: () => true, now: () => new Date("2026-08-26T10:00:00.000Z") });
  assert.equal(failed.failed, 1);
  const retained = (await storage.list())[0];
  assert.equal(retained.attempts, 1);
  assert.equal(retained.nextEligibleRetryAt, "2026-08-26T10:00:05.000Z");
  assert.equal(await nextFlightTrackRetryAt(storage), "2026-08-26T10:00:05.000Z");
  fail = false;
  const retried = await drainFlightTrackQueue({ scope, storage, transport, online: () => true, now: () => new Date("2026-08-26T10:00:05.000Z") });
  assert.equal(retried.succeeded, 1);
  assert.equal((await storage.list()).length, 0);
});

test("upload metadata failed reste idempotemment retryable", async () => {
  signedIn();
  const storage = new MemoryFlightTrackQueueStorage();
  await enqueueFlightTrackJob(storage, { scope, flightId: "flight-a", operation: "UPLOAD" });
  let blobUploads = 0;
  let metadataAttempts = 0;
  const transport = { upload: async () => { blobUploads += 1; metadataAttempts += 1; if (metadataAttempts === 1) throw new Error("TRACK_METADATA_UPDATE:500"); }, download: async () => {}, cleanup: async () => {} };
  await drainFlightTrackQueue({ scope, storage, transport, online: () => true, now: () => new Date(0) });
  await drainFlightTrackQueue({ scope, storage, transport, online: () => true, now: () => new Date(5_000) });
  assert.equal(blobUploads, 2);
  assert.equal((await storage.list()).length, 0);
});

test("DOWNLOAD checksum, blob absent et réseau sont conservés avec catégorie sûre", async () => {
  for (const [message, category] of [["TRACK_CHECKSUM_MISMATCH", "INTEGRITY"], ["TRACK_DOWNLOAD:NOT_FOUND", "NETWORK"], ["NETWORK_TIMEOUT", "NETWORK"]]) {
    signedIn();
    const storage = new MemoryFlightTrackQueueStorage();
    await enqueueFlightTrackJob(storage, { scope, flightId: `flight-${category}-${message}`, operation: "DOWNLOAD" });
    await drainFlightTrackQueue({ scope, storage, transport: { upload: async () => {}, download: async () => { throw new Error(message); }, cleanup: async () => {} }, online: () => true, now: () => new Date(0) });
    assert.equal((await storage.list())[0].lastErrorCategory, category);
  }
});

test("DELETE succès, objet absent idempotent et retry réseau", async () => {
  signedIn();
  const storage = new MemoryFlightTrackQueueStorage();
  await enqueueFlightTrackJob(storage, { scope, flightId: "flight-delete", operation: "DELETE" });
  let attempt = 0;
  const transport = { upload: async () => {}, download: async () => {}, cleanup: async () => { attempt += 1; if (attempt === 1) throw new Error("NETWORK_TIMEOUT"); } };
  await drainFlightTrackQueue({ scope, storage, transport, online: () => true, now: () => new Date(0) });
  await drainFlightTrackQueue({ scope, storage, transport, online: () => true, now: () => new Date(5_000) });
  assert.equal((await storage.list()).length, 0);
});

test("double drain partage une exécution unique", async () => {
  signedIn();
  const storage = new MemoryFlightTrackQueueStorage();
  await enqueueFlightTrackJob(storage, { scope, flightId: "flight-a", operation: "UPLOAD" });
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const input = { scope, storage, transport: { upload: async () => { calls += 1; await gate; }, download: async () => {}, cleanup: async () => {} }, online: () => true };
  const first = drainFlightTrackQueue(input);
  const second = drainFlightTrackQueue(input);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("USER switch et logout empêchent retrait/exécution sous un autre scope", async () => {
  signedIn();
  const storage = new MemoryFlightTrackQueueStorage();
  await enqueueFlightTrackJob(storage, { scope, flightId: "flight-a", operation: "UPLOAD" });
  let calls = 0;
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  const logout = await drainFlightTrackQueue({ scope, storage, transport: { upload: async () => { calls += 1; }, download: async () => {}, cleanup: async () => {} }, online: () => true });
  assert.equal(logout.stoppedForUserSwitch, true);
  signedIn("user-b");
  await drainFlightTrackQueue({ scope, storage, transport: { upload: async () => { calls += 1; }, download: async () => {}, cleanup: async () => {} }, online: () => true });
  assert.equal(calls, 0);
  assert.equal((await storage.list()).length, 1);
});
