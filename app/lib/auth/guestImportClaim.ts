import { fingerprint, makeGuestManifest, type GuestImportManifest } from "./guestImportManifest.ts";
export const GUEST_IMPORT_CLAIM_DB = "balloon-companion-guest-import-claims-v1";
export const GUEST_IMPORT_CLAIM_STORE = "claims";
export type GuestImportClaim = Readonly<{ id: string; version: 1; userId: string; deviceId: string; manifest: GuestImportManifest }>;
export type ClaimResult = Readonly<{ state: "OWNED" | "CLAIMED_OTHER" | "STALE_MANIFEST"; claim?: GuestImportClaim }>;
async function openClaims(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(GUEST_IMPORT_CLAIM_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(GUEST_IMPORT_CLAIM_STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("CLAIM_STORAGE_BLOCKED"));
  });
}
function validateClaim(value: unknown): asserts value is GuestImportClaim {
  const row = value as GuestImportClaim;
  if (!row || row.version !== 1 || typeof row.userId !== "string" || !row.userId || typeof row.deviceId !== "string" || !row.deviceId || !row.manifest || row.manifest.version !== 1 || row.id !== row.manifest.id || !Array.isArray(row.manifest.entries) || !row.manifest.entries.length || row.manifest.entries.some(e => typeof e.identity !== "string" || !e.identity || typeof e.locator !== "string" || !e.locator || typeof e.digest !== "string" || !/^[a-f0-9]{64}$/.test(e.digest) || !e.value || typeof e.value !== "object" || Array.isArray(e.value) || !["GUEST", "LEGACY"].includes(e.source) || !["singleton", "list", "opening", "journal", "ascension", "flight", "document"].includes(e.kind) || typeof e.key !== "string")) throw new Error("INVALID_CLAIM");
}
export async function readGuestImportClaims(factory: IDBFactory, assertCurrent: () => void): Promise<readonly GuestImportClaim[]> {
  assertCurrent(); if (!factory.databases) throw new Error("CLAIM_DISCOVERY_UNAVAILABLE");
  if (!(await factory.databases()).some(db => db.name === GUEST_IMPORT_CLAIM_DB)) return [];
  assertCurrent(); const db = await openClaims(factory);
  try {
    const claims = await new Promise<GuestImportClaim[]>((resolve, reject) => {
      const tx = db.transaction(GUEST_IMPORT_CLAIM_STORE, "readonly"), request = tx.objectStore(GUEST_IMPORT_CLAIM_STORE).getAll();
      tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("CLAIM_READ_FAILED"));
    });
    for (const claim of claims) {
      validateClaim(claim);
      if ((await makeGuestManifest(claim.manifest.entries)).id !== claim.id) throw new Error("INVALID_MANIFEST");
      for (const entry of claim.manifest.entries) if (await fingerprint({ value: entry.value, file: entry.file, context: entry.context }) !== entry.digest) throw new Error("INVALID_SNAPSHOT");
    }
    assertCurrent(); return claims;
  } finally { db.close(); }
}
/** Atomic ownership for the manifest AND its identities, resolved after commit. */
export async function acquireGuestImportClaim(factory: IDBFactory, manifest: GuestImportManifest, userId: string, deviceId: string, assertCurrent: () => void): Promise<ClaimResult> {
  assertCurrent(); if (!userId || !deviceId || !manifest.entries.length) throw new Error("INVALID_CLAIM_OWNER");
  const db = await openClaims(factory);
  try {
    assertCurrent();
    return await new Promise<ClaimResult>((resolve, reject) => {
      const tx = db.transaction(GUEST_IMPORT_CLAIM_STORE, "readwrite", { durability: "strict" }), store = tx.objectStore(GUEST_IMPORT_CLAIM_STORE);
      let result: ClaimResult = { state: "STALE_MANIFEST" }, failure: unknown;
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          assertCurrent(); const claims = request.result as GuestImportClaim[]; claims.forEach(validateClaim);
          const existing = claims.find(claim => claim.id === manifest.id);
          if (existing) result = { state: existing.userId === userId ? "OWNED" : "CLAIMED_OTHER", claim: existing };
          else {
            const occupied = new Set(claims.flatMap(claim => claim.manifest.entries.map(e => e.identity)));
            if (!manifest.entries.some(e => occupied.has(e.identity))) {
              const claim = { id: manifest.id, version: 1, userId, deviceId, manifest: structuredClone(manifest) } satisfies GuestImportClaim;
              store.add(claim); result = { state: "OWNED", claim };
            }
          }
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error("CLAIM_STORAGE_FAILED"));
    });
  } finally { db.close(); }
}
