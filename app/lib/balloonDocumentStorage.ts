import { withSyncIntents, putIndexedDbWithSyncIntents, recoverIndexedDbSyncIntents, isLocalSyncDeleted, LOCAL_SYNC_DELETED } from "./durableSyncIntent.ts";
import type { LocalDataScope } from "./auth/dataScope.ts";
import type { SyncOutboxStorage } from "./syncOutbox.ts";
import { sortBalloonDocuments, supportedBalloonDocumentMimeType, validateBalloonDocumentFile, type BalloonDocument, type BalloonDocumentChanges, type BalloonDocumentStorage, type NewBalloonDocumentMetadata } from "./balloonDocuments.ts";
import { getRuntimeDataScope, scopedIndexedDbName } from "./auth/dataScopeRuntime.ts";
import { enqueueLocalSyncMutation } from "./syncOutbox.ts";

export const BALLOON_DOCUMENT_DB_NAME = "balloon-companion-documents";
export const BALLOON_DOCUMENT_DB_VERSION = 1;
const DOCUMENTS_STORE = "documents";
export const BALLOON_DOCUMENTS_STORE = DOCUMENTS_STORE;
const FILES_STORE = "files";
export const BALLOON_DOCUMENT_FILES_STORE = FILES_STORE;
const BALLOON_INDEX = "balloonId";
export const BALLOON_DOCUMENTS_CHANGED_EVENT = "balloon-companion:documents-changed";

type StoredFile = { documentId: string; storageKey: string; file: Blob };

export class BalloonDocumentStorageError extends Error {
  readonly code: "UNAVAILABLE" | "QUOTA_EXCEEDED" | "WRITE_FAILED" | "NOT_FOUND" | "DELETE_FAILED";

  constructor(code: "UNAVAILABLE" | "QUOTA_EXCEEDED" | "WRITE_FAILED" | "NOT_FOUND" | "DELETE_FAILED", message: string) {
    super(message);
    this.name = "BalloonDocumentStorageError";
    this.code = code;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error ?? new Error("Transaction interrompue")); });
}

function storageError(error: unknown, fallback: "WRITE_FAILED" | "DELETE_FAILED"): BalloonDocumentStorageError {
  if (error instanceof DOMException && error.name === "QuotaExceededError") return new BalloonDocumentStorageError("QUOTA_EXCEEDED", "Stockage insuffisant sur cet appareil.");
  return error instanceof BalloonDocumentStorageError ? error : new BalloonDocumentStorageError(fallback, fallback === "WRITE_FAILED" ? "Le fichier n’a pas pu être enregistré." : "Le document n’a pas pu être supprimé.");
}

function identifier(): string { return globalThis.crypto?.randomUUID?.() ?? `document-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export function mergeDocumentMetadataFromCloud(current: BalloonDocument | null, cloud: BalloonDocument): BalloonDocument {
  return { ...cloud, ...(current?.storageKey ? { storageKey: current.storageKey } : {}) };
}

export class IndexedDbBalloonDocumentStorage implements BalloonDocumentStorage {
  private readonly databasePromises = new Map<string, Promise<IDBDatabase>>();
  private readonly factory: IDBFactory | undefined;

  constructor(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB) {
    this.factory = factory;
  }

  private database(scope: LocalDataScope | null = getRuntimeDataScope()): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new BalloonDocumentStorageError("UNAVAILABLE", "Le stockage local des documents n’est pas disponible sur cet appareil."));
    if (!scope) return Promise.reject(new BalloonDocumentStorageError("UNAVAILABLE", "Le scope local n’est pas encore disponible."));
    const databaseName = scopedIndexedDbName(scope, BALLOON_DOCUMENT_DB_NAME);
    if (!this.databasePromises.has(databaseName)) this.databasePromises.set(databaseName, new Promise((resolve, reject) => {
      const request = this.factory!.open(databaseName, BALLOON_DOCUMENT_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) database.createObjectStore(DOCUMENTS_STORE, { keyPath: "id" }).createIndex(BALLOON_INDEX, "balloonId", { unique: false });
        if (!database.objectStoreNames.contains(FILES_STORE)) database.createObjectStore(FILES_STORE, { keyPath: "documentId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.databasePromises.delete(databaseName); reject(request.error); };
      request.onblocked = () => reject(new BalloonDocumentStorageError("UNAVAILABLE", "Le stockage local est occupé par une autre version de l’application."));
    }));
    return this.databasePromises.get(databaseName)!;
  }

  async listByBalloonId(balloonId: string, scope: LocalDataScope | null = getRuntimeDataScope()): Promise<readonly BalloonDocument[]> {
    const database = await this.database(scope);
    const transaction = database.transaction(DOCUMENTS_STORE, "readonly");
    const documents = await requestResult(transaction.objectStore(DOCUMENTS_STORE).index(BALLOON_INDEX).getAll(balloonId)) as BalloonDocument[];
    await transactionDone(transaction);
    return sortBalloonDocuments(documents.filter((value) => !isLocalSyncDeleted(value)));
  }
  async listDocuments(): Promise<readonly BalloonDocument[]> { const database = await this.database(); const transaction = database.transaction(DOCUMENTS_STORE, "readonly"); const documents = await requestResult(transaction.objectStore(DOCUMENTS_STORE).getAll()) as BalloonDocument[]; await transactionDone(transaction); return sortBalloonDocuments(documents.filter((value) => !isLocalSyncDeleted(value))); }
  async getDocument(documentId: string, scope: LocalDataScope | null = getRuntimeDataScope()): Promise<BalloonDocument | null> { const database = await this.database(scope); const transaction = database.transaction(DOCUMENTS_STORE, "readonly"); const result = await requestResult(transaction.objectStore(DOCUMENTS_STORE).get(documentId)) as BalloonDocument | undefined; await transactionDone(transaction); return isLocalSyncDeleted(result) ? null : result ?? null; }
  async getDocumentFile(documentId: string): Promise<Blob | null> { const database = await this.database(); const transaction = database.transaction(FILES_STORE, "readonly"); const result = await requestResult(transaction.objectStore(FILES_STORE).get(documentId)) as StoredFile | undefined; await transactionDone(transaction); return result?.file ?? null; }
  async hasLocalBlob(documentId: string): Promise<boolean> { const database = await this.database(); const transaction = database.transaction(FILES_STORE, "readonly"); const count = await requestResult(transaction.objectStore(FILES_STORE).count(documentId)); await transactionDone(transaction); return count > 0; }
  /** Pull-only metadata write. The file store is deliberately never opened for writing. */
  async applyMetadataFromCloudWithoutEnqueue(scope: `USER:${string}`, id: string, metadata: BalloonDocument | null): Promise<boolean> {
    if (getRuntimeDataScope() !== scope) return false;
    const database = await this.database(scope);
    const current = metadata ? await this.getDocument(id, scope) : null;
    const value = metadata ? mergeDocumentMetadataFromCloud(current, metadata) : null;
    const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
    if (value) transaction.objectStore(DOCUMENTS_STORE).put(value);
    else transaction.objectStore(DOCUMENTS_STORE).delete(id);
    await transactionDone(transaction);
    this.notify();
    return true;
  }
  async addDocument(metadata: NewBalloonDocumentMetadata, file: File): Promise<BalloonDocument> { const scope = getRuntimeDataScope(); if (!scope) throw new BalloonDocumentStorageError("UNAVAILABLE", "Scope local indisponible.");
    const validation = validateBalloonDocumentFile(file); if (validation) throw new BalloonDocumentStorageError("WRITE_FAILED", validation);
    if (!metadata.title.trim()) throw new BalloonDocumentStorageError("WRITE_FAILED", "Le titre du document est obligatoire.");
    const database = await this.database(scope); const id = identifier(); const storageKey = `balloon/${metadata.balloonId}/${id}`; const now = new Date().toISOString();
    const document: BalloonDocument = { id, balloonId: metadata.balloonId, category: metadata.category, title: metadata.title.trim(), originalFileName: file.name, mimeType: supportedBalloonDocumentMimeType(file)!, sizeBytes: file.size, createdAt: now, updatedAt: now, storageKey, ...(metadata.notes?.trim() ? { notes: metadata.notes.trim() } : {}), ...(metadata.issueDate ? { issueDate: metadata.issueDate } : {}), ...(metadata.expiryDate ? { expiryDate: metadata.expiryDate } : {}) };
    const transaction = database.transaction([DOCUMENTS_STORE, FILES_STORE], "readwrite");
    try { transaction.objectStore(FILES_STORE).add({ documentId: id, storageKey, file } satisfies StoredFile); transaction.objectStore(DOCUMENTS_STORE).add(withSyncIntents(document, [{ entityType: "balloon-document", entityId: document.id, operation: "UPSERT" }], document, scope)); await transactionDone(transaction); enqueueLocalSyncMutation("balloon-document", id, "UPSERT", scope); this.notify(); return document; } catch (error) { try { transaction.abort(); } catch {} throw storageError(error, "WRITE_FAILED"); }
  }
  /** Metadata-only creation used by the controlled DEV Cloud test; no file-store entry is created. */
  async addMetadataOnlyDocumentForCloudTest(
    metadata: NewBalloonDocumentMetadata,
    fileMetadata: Readonly<{ originalFileName: string; mimeType: string; sizeBytes: number }>,
  ): Promise<BalloonDocument> { const scope = getRuntimeDataScope(); if (!scope) throw new BalloonDocumentStorageError("UNAVAILABLE", "Scope local indisponible.");
    if (!metadata.title.trim() || !fileMetadata.originalFileName.trim() || fileMetadata.mimeType !== "application/pdf" || fileMetadata.sizeBytes <= 0) {
      throw new BalloonDocumentStorageError("WRITE_FAILED", "Métadonnées du document de test invalides.");
    }
    const database = await this.database(scope);
    const id = identifier();
    const now = new Date().toISOString();
    const document: BalloonDocument = {
      id,
      balloonId: metadata.balloonId,
      category: metadata.category,
      title: metadata.title.trim(),
      originalFileName: fileMetadata.originalFileName.trim(),
      mimeType: fileMetadata.mimeType,
      sizeBytes: fileMetadata.sizeBytes,
      createdAt: now,
      updatedAt: now,
      storageKey: `metadata-only/${metadata.balloonId}/${id}`,
      ...(metadata.notes?.trim() ? { notes: metadata.notes.trim() } : {}),
      ...(metadata.issueDate ? { issueDate: metadata.issueDate } : {}),
      ...(metadata.expiryDate ? { expiryDate: metadata.expiryDate } : {}),
    };
    const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
    transaction.objectStore(DOCUMENTS_STORE).add(withSyncIntents(document, [{ entityType: "balloon-document", entityId: document.id, operation: "UPSERT" }], document, scope));
    await transactionDone(transaction);
    await enqueueLocalSyncMutation("balloon-document", id, "UPSERT", scope);
    this.notify();
    return document;
  }
  async updateDocument(documentId: string, changes: BalloonDocumentChanges): Promise<BalloonDocument> { const scope = getRuntimeDataScope(); if (!scope) throw new BalloonDocumentStorageError("UNAVAILABLE", "Scope local indisponible."); const current = await this.getDocument(documentId, scope); if (!current) throw new BalloonDocumentStorageError("NOT_FOUND", "Document introuvable."); const updated = { ...current, ...changes, title: changes.title?.trim() || current.title, updatedAt: new Date().toISOString() }; const database = await this.database(scope); const transaction = database.transaction(DOCUMENTS_STORE, "readwrite"); putIndexedDbWithSyncIntents(transaction.objectStore(DOCUMENTS_STORE), updated, [{ entityType: "balloon-document", entityId: documentId, operation: "UPSERT" }], scope); await transactionDone(transaction); enqueueLocalSyncMutation("balloon-document", documentId, "UPSERT", scope); this.notify(); return updated; }
  async replaceDocumentFile(documentId: string, file: File): Promise<BalloonDocument> { const scope = getRuntimeDataScope(); if (!scope) throw new BalloonDocumentStorageError("UNAVAILABLE", "Scope local indisponible."); const validation = validateBalloonDocumentFile(file); if (validation) throw new BalloonDocumentStorageError("WRITE_FAILED", validation); const current = await this.getDocument(documentId, scope); if (!current) throw new BalloonDocumentStorageError("NOT_FOUND", "Document introuvable."); const storageKey = current.storageKey ?? `balloon/${current.balloonId}/${documentId}`; const updated = { ...current, storageKey, originalFileName: file.name, mimeType: supportedBalloonDocumentMimeType(file)!, sizeBytes: file.size, updatedAt: new Date().toISOString() }; const database = await this.database(scope); const transaction = database.transaction([DOCUMENTS_STORE, FILES_STORE], "readwrite"); try { transaction.objectStore(FILES_STORE).put({ documentId, storageKey, file } satisfies StoredFile); putIndexedDbWithSyncIntents(transaction.objectStore(DOCUMENTS_STORE), updated, [{ entityType: "balloon-document", entityId: documentId, operation: "UPSERT" }], scope); await transactionDone(transaction); enqueueLocalSyncMutation("balloon-document", documentId, "UPSERT", scope); this.notify(); return updated; } catch (error) { try { transaction.abort(); } catch {} throw storageError(error, "WRITE_FAILED"); } }
  async deleteDocument(documentId: string): Promise<void> { const scope = getRuntimeDataScope(); if (!scope) throw new BalloonDocumentStorageError("UNAVAILABLE", "Scope local indisponible."); const current = await this.getDocument(documentId, scope); if (!current) return; const database = await this.database(scope); const transaction = database.transaction([DOCUMENTS_STORE, FILES_STORE], "readwrite"); try { transaction.objectStore(FILES_STORE).delete(documentId); if (scope === "GUEST") transaction.objectStore(DOCUMENTS_STORE).delete(documentId); else putIndexedDbWithSyncIntents(transaction.objectStore(DOCUMENTS_STORE), { id: documentId, balloonId: current.balloonId, [LOCAL_SYNC_DELETED]: true }, [{ entityType: "balloon-document", entityId: documentId, operation: "DELETE" }], scope); await transactionDone(transaction); enqueueLocalSyncMutation("balloon-document", documentId, "DELETE", scope); this.notify(); } catch (error) { try { transaction.abort(); } catch {} throw storageError(error, "DELETE_FAILED"); } }
  async countByBalloonId(balloonId: string): Promise<number> { return (await this.listByBalloonId(balloonId)).length; }
  async deleteByBalloonId(balloonId: string): Promise<void> { const scope = getRuntimeDataScope(); if (!scope) throw new BalloonDocumentStorageError("UNAVAILABLE", "Scope local indisponible."); const documents = await this.listByBalloonId(balloonId, scope); const database = await this.database(scope); const transaction = database.transaction([DOCUMENTS_STORE, FILES_STORE], "readwrite"); try { for (const document of documents) { transaction.objectStore(FILES_STORE).delete(document.id); if (scope === "GUEST") transaction.objectStore(DOCUMENTS_STORE).delete(document.id); else putIndexedDbWithSyncIntents(transaction.objectStore(DOCUMENTS_STORE), { id: document.id, balloonId: document.balloonId, [LOCAL_SYNC_DELETED]: true }, [{ entityType: "balloon-document", entityId: document.id, operation: "DELETE" }], scope); } await transactionDone(transaction); for (const document of documents) enqueueLocalSyncMutation("balloon-document", document.id, "DELETE", scope); this.notify(); } catch (error) { try { transaction.abort(); } catch {} throw storageError(error, "DELETE_FAILED"); } }
  async recoverSyncIntents(scope: `USER:${string}`, outbox: SyncOutboxStorage): Promise<void> {
    if (getRuntimeDataScope() !== scope) throw new Error("SYNC_INTENT_USER_SWITCH");
    if (outbox.getScope?.() !== scope) throw new Error("SYNC_INTENT_SCOPE_MISMATCH");
    const database = await this.database(scope);
    if (database.name && database.name !== scopedIndexedDbName(scope, BALLOON_DOCUMENT_DB_NAME)) throw new Error("SYNC_INTENT_SCOPE_MISMATCH");
    await recoverIndexedDbSyncIntents(database, DOCUMENTS_STORE, scope, outbox);
  }
  private notify() { if (typeof window !== "undefined") window.dispatchEvent(new Event(BALLOON_DOCUMENTS_CHANGED_EVENT)); }
}

export const balloonDocumentStorage = new IndexedDbBalloonDocumentStorage();
