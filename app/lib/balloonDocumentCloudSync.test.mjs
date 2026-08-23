import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BrowserCloudSyncPayloadProvider } from "./cloudSyncBrowser.ts";

const scope = "USER:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const document = {
  id: "document-a",
  balloonId: "balloon-a",
  category: "INSURANCE",
  title: "Assurance test",
  originalFileName: "assurance.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1234,
  createdAt: "2026-08-23T12:00:00.000Z",
  updatedAt: "2026-08-23T12:00:00.000Z",
  storageKey: "balloon/balloon-a/document-a",
  notes: "Métadonnées uniquement",
  issueDate: "2026-08-01",
  expiryDate: "2027-08-01",
};

const storage = { length: 0, clear() {}, getItem() { return null; }, key() { return null; }, removeItem() {}, setItem() {} };

test("balloon-document produit uniquement le payload canonique document", async () => {
  const provider = new BrowserCloudSyncPayloadProvider(storage, scope, async () => null, async (id) => id === document.id ? document : null);
  const payload = await provider.build({
    mutationId: "mutation-a", entityType: "balloon-document", entityId: document.id,
    operation: "UPSERT", baseRevision: 0, createdAt: document.createdAt, attempts: 0,
  });
  assert.deepEqual(payload, {
    serverEntityType: "document",
    serverEntityId: "document-a",
    payload: {
      balloon_id: "balloon-a",
      category: "INSURANCE",
      title: "Assurance test",
      original_filename: "assurance.pdf",
      mime_type: "application/pdf",
      size_bytes: 1234,
      notes: "Métadonnées uniquement",
      issue_date: "2026-08-01",
      expiry_date: "2027-08-01",
    },
  });
  for (const forbidden of ["storageKey", "object_key", "checksum", "blob", "file", "content"]) {
    assert.equal(Object.hasOwn(payload.payload, forbidden), false);
  }
});

test("DELETE document ne lit aucun fichier ni aucune métadonnée", async () => {
  let loads = 0;
  const provider = new BrowserCloudSyncPayloadProvider(storage, scope, async () => null, async () => { loads += 1; return document; });
  const payload = await provider.build({
    mutationId: "mutation-b", entityType: "balloon-document", entityId: document.id,
    operation: "DELETE", baseRevision: 1, createdAt: document.createdAt, attempts: 0,
  });
  assert.deepEqual(payload, { serverEntityType: "document", serverEntityId: "document-a", payload: {} });
  assert.equal(loads, 0);
});

test("balloon-document est ciblé uniquement et son stockage conserve les mutations métier", () => {
  const service = readFileSync(new URL("./cloudSyncService.ts", import.meta.url), "utf8");
  const documentStorage = readFileSync(new URL("./balloonDocumentStorage.ts", import.meta.url), "utf8");
  const automatic = service.match(/PHASE_3A_SYNC_ENTITY_TYPES = Object\.freeze\(\[([\s\S]*?)\]/)?.[1] ?? "";
  const targeted = service.match(/PHASE_3B_TARGETED_SYNC_ENTITY_TYPES = Object\.freeze\(([^\n]+)/)?.[1] ?? "";
  assert.doesNotMatch(automatic, /balloon-document/);
  assert.match(targeted, /balloon-document/);
  assert.match(documentStorage, /enqueueLocalSyncMutation\("balloon-document", id\)/);
  assert.match(documentStorage, /enqueueLocalSyncMutation\("balloon-document", documentId, "DELETE"\)/);
});

test("la migration document limite strictement le payload et laisse le blob local", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260823130000_cloud_sync_documents.sql", import.meta.url), "utf8");
  for (const field of ["balloon_id", "category", "title", "original_filename", "mime_type", "size_bytes", "notes", "issue_date", "expiry_date"]) {
    assert.match(migration, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(migration, /insert into public\.documents[\s\S]*?\([^;]*object_key/);
  assert.doesNotMatch(migration, /insert into public\.documents[\s\S]*?\([^;]*checksum/);
  for (const status of ["ALREADY_APPLIED", "CONFLICT", "NOT_FOUND", "APPLIED"]) assert.match(migration, new RegExp(status));
});
