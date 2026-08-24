import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CloudPullService } from "./cloudPullService.ts";
import { MemorySyncOutboxStorage } from "./syncOutbox.ts";
import { mergeDocumentMetadataFromCloud } from "./balloonDocumentStorage.ts";

const scope = "USER:user-1";
const now = "2026-08-24T09:00:00.000Z";
const document = (overrides = {}) => ({ id: "document-a", balloonId: "balloon-a", category: "FLIGHT_MANUAL", title: "Cloud manual", originalFileName: "manual.pdf", mimeType: "application/pdf", sizeBytes: 1234, createdAt: now, updatedAt: now, notes: "metadata only", issueDate: "2026-01-01", expiryDate: "2027-01-01", ...overrides });
const row = (overrides = {}) => ({ id: "document-a", entityId: "document-a", userId: "user-1", revision: 0, createdAt: now, updatedAt: now, deletedAt: null, value: document(), ...overrides });

class Cursors {
  values = new Map();
  async get(_scope, domain) { return this.values.get(domain) ?? null; }
  async set(_scope, domain, cursor) { this.values.set(domain, cursor); }
}

function context(rows = [row()], blobOnTombstone = false) {
  const outbox = new MemorySyncOutboxStorage({ dependencies: { createId: () => crypto.randomUUID(), now: () => now } });
  const cursors = new Cursors(), applied = [];
  let currentScope = scope, user = "user-1", checks = 0, switchAt = Infinity;
  const deps = {
    scope,
    getScope: () => (++checks >= switchAt ? "USER:user-2" : currentScope),
    getOnlineUserId: async () => user,
    outbox,
    cursors,
    readPage: async () => [],
    applyLocally: () => false,
    documentDomain: {
      readPage: async (cursor, limit) => rows.filter((candidate) => !cursor || candidate.updatedAt > cursor.updatedAt || (candidate.updatedAt === cursor.updatedAt && candidate.id > cursor.id)).slice(0, limit),
      localAnomaly: (cloud) => cloud.deletedAt && blobOnTombstone ? "LOCAL_BLOB_PRESENT" : null,
      applyLocally: async (cloud) => { applied.push(cloud); return true; },
    },
    recordConflict: async () => {},
  };
  return { deps, outbox, cursors, applied, setScope: (value) => { currentScope = value; }, setUser: (value) => { user = value; }, switchAt: (value) => { switchAt = value; } };
}

test("appareil vierge importe une metadata document avec sidecar et sans mutation", async () => {
  const ctx = context();
  await ctx.outbox.enqueue({ entityType: "flight", entityId: "unrelated", operation: "UPSERT" });
  const service = new CloudPullService(ctx.deps);
  assert.equal((await service.pullDocuments()).applied, 1);
  assert.equal((await service.pullDocuments()).applied, 0);
  assert.equal(ctx.applied.length, 1);
  assert.deepEqual(await ctx.outbox.getMetadata("balloon-document", "document-a"), { entityType: "balloon-document", entityId: "document-a", revision: 0, updatedAt: now });
  assert.deepEqual((await ctx.outbox.list()).map(({ entityType }) => entityType), ["flight"]);
});

test("INSERT metadata-only n'invente ni blob ni storageKey", () => {
  const inserted = mergeDocumentMetadataFromCloud(null, document());
  assert.equal("storageKey" in inserted, false);
  assert.deepEqual(inserted, document());
});

test("UPDATE remplace seulement les metadata et conserve strictement le storageKey local", () => {
  const current = document({ title: "Local", storageKey: "balloon/balloon-a/document-a" });
  const updated = mergeDocumentMetadataFromCloud(current, document({ title: "Cloud updated", notes: "updated" }));
  assert.equal(updated.title, "Cloud updated");
  assert.equal(updated.notes, "updated");
  assert.equal(updated.storageKey, current.storageKey);
});

test("balloon parent absent reste une référence partielle sans ballon fantôme", () => {
  const imported = mergeDocumentMetadataFromCloud(null, document({ balloonId: "missing-balloon" }));
  assert.equal(imported.balloonId, "missing-balloon");
  assert.equal("balloon" in imported, false);
});

test("tombstone sans blob s'applique; avec blob local il bloque sans curseur ni suppression", async () => {
  const cloud = row({ revision: 2, deletedAt: now });
  const safe = context([cloud]);
  assert.equal((await new CloudPullService(safe.deps).pullDocuments()).tombstonesApplied, 1);
  assert.equal((await safe.outbox.getMetadata("balloon-document", "document-a")).deletedAt, now);
  const protectedBlob = context([cloud], true);
  const result = await new CloudPullService(protectedBlob.deps).pullDocuments();
  assert.equal(result.state, "BLOCKED_ANOMALY");
  assert.equal(result.anomalies[0].reason, "LOCAL_BLOB_PRESENT");
  assert.equal(protectedBlob.applied.length, 0);
  assert.equal(protectedBlob.cursors.values.has("balloon-document"), false);
});

test("pending égal est préservé; distant avancé, tombstone pending et collision sont des conflits", async () => {
  const equal = context([row({ revision: 2 })]);
  await equal.outbox.setMetadata({ entityType: "balloon-document", entityId: "document-a", revision: 2, updatedAt: now });
  await equal.outbox.enqueue({ entityType: "balloon-document", entityId: "document-a", operation: "UPSERT", baseRevision: 2 });
  assert.equal((await new CloudPullService(equal.deps).pullDocuments()).preservedLocalPending, 1);
  for (const scenario of [
    { cloud: row({ revision: 2 }), sidecar: 1, reason: "REMOTE_ADVANCED" },
    { cloud: row({ revision: 1, deletedAt: now }), sidecar: 1, reason: "REMOTE_TOMBSTONE" },
    { cloud: row(), sidecar: null, reason: "LOCAL_CREATION_COLLISION" },
  ]) {
    const ctx = context([scenario.cloud]);
    if (scenario.sidecar !== null) {
      await ctx.outbox.setMetadata({ entityType: "balloon-document", entityId: "document-a", revision: scenario.sidecar, updatedAt: now });
      await ctx.outbox.enqueue({ entityType: "balloon-document", entityId: "document-a", operation: "UPSERT", baseRevision: scenario.sidecar });
    } else {
      const mutation = { mutationId: "collision", entityType: "balloon-document", entityId: "document-a", operation: "UPSERT", baseRevision: 0, createdAt: now, attempts: 0 };
      ctx.deps.outbox = new MemorySyncOutboxStorage({ mutations: new Map([[mutation.mutationId, mutation]]) });
    }
    assert.equal((await new CloudPullService(ctx.deps).pullDocuments()).conflicts[0].reason, scenario.reason);
    assert.equal(ctx.applied.length, 0);
  }
});

test("révision distante derrière sidecar bloque sans rebase", async () => {
  const ctx = context([row({ revision: 1 })]);
  await ctx.outbox.setMetadata({ entityType: "balloon-document", entityId: "document-a", revision: 2, updatedAt: now });
  const result = await new CloudPullService(ctx.deps).pullDocuments();
  assert.equal(result.state, "BLOCKED_ANOMALY");
  assert.equal(result.anomalies[0].reason, "REMOTE_REVISION_BEHIND_LOCAL");
});

test("pagination, timestamps identiques, GUEST, session absente et USER switch sont sûrs", async () => {
  const paged = context(["a", "b", "c"].map((id) => row({ id, entityId: id })));
  assert.deepEqual((await new CloudPullService(paged.deps).pullDocuments(2)).cursor, { updatedAt: now, id: "c" });
  const guest = context(); guest.deps.scope = "GUEST"; guest.setScope("GUEST");
  assert.equal((await new CloudPullService(guest.deps).pullDocuments()).state, "REFUSED_GUEST");
  const expired = context(); expired.setUser(null);
  assert.equal((await new CloudPullService(expired.deps).pullDocuments()).state, "REFUSED_NO_SESSION");
  const switched = context(); switched.switchAt(4);
  assert.equal((await new CloudPullService(switched.deps).pullDocuments()).state, "STOPPED_USER_SWITCH");
  assert.equal(switched.applied.length, 0);
});

test("adaptateur, stockage et helpers excluent blob, R2, téléchargement, enqueue et auto-pull", () => {
  const browser = readFileSync(new URL("./cloudPullBrowser.ts", import.meta.url), "utf8");
  const storage = readFileSync(new URL("./balloonDocumentStorage.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../components/cloud/CloudSyncRuntime.tsx", import.meta.url), "utf8");
  assert.match(browser, /from\("documents"\)[\s\S]*?\.select\("id,user_id,revision,created_at,updated_at,deleted_at,balloon_id,category,title,original_filename,mime_type,size_bytes,notes,issue_date,expiry_date"\)/);
  const adapter = browser.match(/export function createBrowserDocumentPullService[\s\S]*$/)?.[0] ?? "";
  assert.doesNotMatch(adapter, /object_key|storage_provider|checksum|blob_status|fetch\(|download|signed|R2|syncMutationById|syncPendingMutations|\.rpc\(|\.insert\(|\.upsert\(/i);
  const silent = storage.match(/async applyMetadataFromCloudWithoutEnqueue[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(silent, /transaction\(DOCUMENTS_STORE, "readwrite"\)/);
  assert.doesNotMatch(silent, /FILES_STORE|enqueueLocalSyncMutation|deleteDocument|deleteByBalloonId/);
  for (const helper of ["pullDocumentsTargeted", "inspectDocumentPullState"]) assert.match(runtime, new RegExp(helper));
  const inspection = runtime.match(/async function inspectDocumentPullState[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(inspection, /getDocumentFile|syncMutationById|syncPendingMutations|\.rpc\(|\.enqueue\(|\.setMetadata\(|save[A-Z]/);
  assert.doesNotMatch(runtime.match(/const schedule = \(delay = 750\)[\s\S]*?return \(\) =>/)?.[0] ?? "", /pullDocuments/);
});
