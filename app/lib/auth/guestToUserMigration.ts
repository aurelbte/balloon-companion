import { balloonRegistrationKey } from "../balloons.ts";
import { BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENT_FILES_STORE, BALLOON_DOCUMENTS_STORE } from "../balloonDocumentStorage.ts";
import { FLIGHT_COMPLETION_STORAGE_KEY } from "../flightCompletionStorage.ts";
import { RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE } from "../recordedFlightStorage.ts";
import { IndexedDbSyncOutboxStorage } from "../syncOutbox.ts";
import { PILOT_QUALIFICATIONS_STORAGE_KEY } from "../pilotQualificationsStorage.ts";
import { normalizeQualificationProfile, type QualificationProfile } from "../pilotQualifications.ts";
import type { PilotQualificationsCloudSnapshot } from "../pilotQualificationsCloudReader.ts";
import { getRuntimeDataScope, getRuntimeDataScopeGeneration, scopedBusinessStorageKey, scopedIndexedDbName } from "./dataScopeRuntime.ts";

import { acquireGuestImportClaim, readGuestImportClaims, type GuestImportClaim } from "./guestImportClaim.ts";
import { SINGLETONS, LISTS, FLIGHT_SESSION_KEY, inspectGuestSources, makeGuestManifest, manifestSourceValues, meaningful, fingerprint, openExistingGuestSource, readSourceRows, type GuestImportManifest } from "./guestImportManifest.ts";
import { getLocalDataMigrationDecision } from "./localDataMigrationDecision.ts";

export const GUEST_TO_USER_MIGRATION_KEY = "balloon-companion-guest-to-user-migration-v1";

export type GuestToUserMigrationCollision = Readonly<{ domain: string; entityId: string; source: "GUEST" | "LEGACY"; reason?: "DUPLICATE_REGISTRATION" }>;
export type GuestToUserMigrationReport = Readonly<{
  state: "COMPLETE" | "COMPLETE_WITH_COLLISIONS" | "CLAIMED_OTHER" | "REVIEW_REQUIRED" | "IMPORT_BLOCKED" | "OBSOLETE" | "SOURCE_CHANGED" | "DEFERRED";
  manifestId?: string;
  imported: number;
  collisions: readonly GuestToUserMigrationCollision[];
  completedDomains: readonly string[];
}>;

type Marker = Readonly<{ userId: string; deviceId: string; completedDomains: readonly string[]; collisions: readonly GuestToUserMigrationCollision[]; completedAt?: string; manifestId?: string }>;
type MigrationOutbox = Pick<IndexedDbSyncOutboxStorage, "enqueue"> & Partial<Pick<IndexedDbSyncOutboxStorage, "getScope">>;

export function selectAbsentMigrationRecords(destination: readonly Record<string, unknown>[], incoming: readonly Record<string, unknown>[]) {
  const known = [...destination], additions: Record<string, unknown>[] = [], conflicts: string[] = [];
  for (const value of incoming) {
    const id = typeof value?.id === "string" ? value.id : null; if (!id) continue;
    const existing = known.find((item) => item.id === id);
    if (!existing) { additions.push(value); known.push(value); } else if (!same(existing, value)) conflicts.push(id);
  }
  return { additions, conflicts } as const;
}

function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function parsed(raw: string | null): unknown { try { return raw === null ? null : JSON.parse(raw); } catch { return null; } }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function records(value: unknown, property: string): Record<string, unknown>[] { const list = object(value)[property]; return Array.isArray(list) ? list.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")) : []; }
function markerId(userId: string, deviceId: string, manifestId?: string): string { return `${userId}:${deviceId}${manifestId ? `:${manifestId}` : ""}`; }
function emptySingleton(entityType: typeof SINGLETONS[number][0], raw: string | null): boolean {
  if (raw === null) return true; const value = object(parsed(raw));
  if (entityType === "pilot-profile") return ["firstName", "lastName", "licenseNumber", "flightTestDueDateIso", "medicalDueDateIso"].every((key) => !value[key]) && !value.usualFunction;
  if (entityType === "weather-preferences") return !value.favoriteWeatherLocationId && !value.weatherModel;
  if (entityType === "aviation-preferences") return !value.airportIcao && (!Array.isArray(value.favorites) || value.favorites.length === 0);
  return false;
}
function markers(storage: Storage): Record<string, Marker> {
  const raw = storage.getItem(GUEST_TO_USER_MIGRATION_KEY); if (raw === null) return {};
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_IMPORT_HISTORY");
  for (const row of Object.values(value) as Marker[]) {
    if (!row || typeof row.userId !== "string" || typeof row.deviceId !== "string" || !Array.isArray(row.completedDomains) || !Array.isArray(row.collisions)) throw new Error("INVALID_IMPORT_HISTORY");
  }
  return value;
}
function saveMarker(storage: Storage, marker: Marker): void { storage.setItem(GUEST_TO_USER_MIGRATION_KEY, JSON.stringify({ ...markers(storage), [markerId(marker.userId, marker.deviceId, marker.manifestId)]: marker })); }

export type PilotQualificationsProfileConflict = Readonly<{
  id: string;
  manifestId: string;
  source: "GUEST" | "LEGACY";
  deviceProfile: QualificationProfile;
  cloudProfile: QualificationProfile;
  cloud: PilotQualificationsCloudSnapshot;
}>;

async function qualificationConflictId(manifestId: string, source: "GUEST" | "LEGACY", deviceProfile: QualificationProfile, cloud: PilotQualificationsCloudSnapshot): Promise<string> {
  return `${manifestId}:${source}:pilot-qualifications-profile:singleton:${await fingerprint({ deviceProfile, cloud })}`;
}

/** Reads only the frozen B6 claim and the current account-scoped value. */
export async function listPilotQualificationsProfileConflicts(input: Readonly<{
  userId: string;
  storage: Storage;
  factory: IDBFactory;
  readCloudQualifications(): Promise<PilotQualificationsCloudSnapshot>;
}>): Promise<readonly PilotQualificationsProfileConflict[]> {
  const scope = `USER:${input.userId}` as const;
  const generation = getRuntimeDataScopeGeneration();
  const assertCurrent = () => {
    if (getRuntimeDataScope() !== scope || getRuntimeDataScopeGeneration() !== generation) throw new Error("IMPORT_OBSOLETE");
  };
  assertCurrent();
  const claims = await readGuestImportClaims(input.factory, assertCurrent);
  const stored = markers(input.storage);
  const cloud = await input.readCloudQualifications();
  const cloudProfile = normalizeQualificationProfile(cloud.value.profile);
  assertCurrent();
  const conflicts: PilotQualificationsProfileConflict[] = [];
  for (const marker of Object.values(stored)) {
    if (marker.userId !== input.userId || !marker.manifestId) continue;
    const claim = claims.find(candidate => candidate.userId === input.userId && candidate.id === marker.manifestId);
    if (!claim) continue;
    for (const collision of marker.collisions) {
      if (collision.domain !== "pilot-qualifications-profile" || collision.entityId !== "singleton") continue;
      const source = manifestSourceValues(claim.manifest, PILOT_QUALIFICATIONS_STORAGE_KEY).find(value => value.source === collision.source);
      const profile = object(parsed(source?.raw ?? null)).profile;
      if (!profile || typeof profile !== "object") throw new Error("INVALID_QUALIFICATION_CONFLICT");
      const deviceProfile = normalizeQualificationProfile(profile);
      conflicts.push({
        id: await qualificationConflictId(claim.id, collision.source, deviceProfile, cloud),
        manifestId: claim.id,
        source: collision.source,
        deviceProfile,
        cloudProfile,
        cloud,
      });
    }
  }
  assertCurrent();
  return conflicts;
}

export async function resolvePilotQualificationsProfileConflict(input: Readonly<{
  userId: string;
  conflictId: string;
  strategy: "DEVICE" | "CLOUD";
  storage: Storage;
  factory: IDBFactory;
  readCloudQualifications(): Promise<PilotQualificationsCloudSnapshot>;
  persistChoice(conflict: PilotQualificationsProfileConflict, strategy: "DEVICE" | "CLOUD"): Promise<void>;
}>): Promise<readonly GuestToUserMigrationCollision[]> {
  const scope = `USER:${input.userId}` as const;
  const generation = getRuntimeDataScopeGeneration();
  const assertCurrent = () => {
    if (getRuntimeDataScope() !== scope || getRuntimeDataScopeGeneration() !== generation) throw new Error("IMPORT_OBSOLETE");
  };
  const available = await listPilotQualificationsProfileConflicts({ userId: input.userId, storage: input.storage, factory: input.factory, readCloudQualifications: input.readCloudQualifications });
  assertCurrent();
  const selected = available.find(conflict => conflict.id === input.conflictId);
  if (!selected) throw new Error("QUALIFICATION_CONFLICT_NOT_FOUND");
  const stored = markers(input.storage);
  const key = Object.keys(stored).find(candidate => {
    const marker = stored[candidate]!;
    return marker.userId === input.userId && marker.manifestId === selected.manifestId
      && marker.collisions.some(collision => collision.domain === "pilot-qualifications-profile" && collision.entityId === "singleton" && collision.source === selected.source);
  });
  if (!key) throw new Error("QUALIFICATION_CONFLICT_NOT_FOUND");

  await input.persistChoice(selected, input.strategy);
  assertCurrent();

  const latest = markers(input.storage);
  const marker = latest[key];
  if (!marker || marker.userId !== input.userId || marker.manifestId !== selected.manifestId) throw new Error("QUALIFICATION_CONFLICT_CHANGED");
  const collisions = marker.collisions.filter(collision => !(collision.domain === "pilot-qualifications-profile" && collision.entityId === "singleton" && collision.source === selected.source));
  saveMarker(input.storage, { ...marker, collisions });
  assertCurrent();
  const claims = await readGuestImportClaims(input.factory, assertCurrent);
  const claimIds = new Set(claims.filter(claim => claim.userId === input.userId).map(claim => claim.id));
  return Object.values(markers(input.storage))
    .filter(candidate => candidate.userId === input.userId && candidate.manifestId && claimIds.has(candidate.manifestId))
    .flatMap(candidate => candidate.collisions);
}

export function guestToUserMigrationComplete(storage: Storage, userId: string, deviceId: string, manifestId: string): boolean {
  return Boolean(markers(storage)[markerId(userId, deviceId, manifestId)]?.completedAt);
}

function mergeList(base: unknown, incoming: unknown, property: string, domain: string, source: "GUEST" | "LEGACY", collisions: GuestToUserMigrationCollision[]) {
  const destination = records(base, property), additions: Record<string, unknown>[] = [];
  for (const item of records(incoming, property)) {
    const existing = [...destination, ...additions].find(({ id }) => id === item.id);
    if (!existing) additions.push(item);
    else if (!same(existing, item)) collisions.push({ domain, entityId: String(item.id), source });
  }
  return { value: { ...object(incoming), ...object(base), [property]: [...destination, ...additions] }, additions };
}

function journalIdentity(item: Record<string, unknown>): string { return typeof item.sourceFlightId === "string" ? item.sourceFlightId : String(item.id); }
function mergeCompletion(base: unknown, incoming: unknown, source: "GUEST" | "LEGACY", collisions: GuestToUserMigrationCollision[]) {
  const current = object(base), candidate = object(incoming);
  const merge = (property: "journalFlights" | "officialAscensions", identity: (item: Record<string, unknown>) => string) => {
    const destination = records(current, property), additions: Record<string, unknown>[] = [];
    for (const item of records(candidate, property)) {
      const id = identity(item); const existing = [...destination, ...additions].find((entry) => identity(entry) === id);
      if (!existing) additions.push(item); else if (!same(existing, item)) collisions.push({ domain: property, entityId: id, source });
    }
    return { all: [...destination, ...additions], additions };
  };
  const journal = merge("journalFlights", journalIdentity), ascensions = merge("officialAscensions", (item) => String(item.id));
  const currentOpening = object(current.openingBalance), incomingOpening = object(candidate.openingBalance);
  const currentOpeningEmpty = currentOpening.confirmed !== true && currentOpening.ascensions == null && currentOpening.officialDurationMinutes == null;
  let openingBalance = currentOpeningEmpty ? incomingOpening : currentOpening;
  if (!currentOpeningEmpty && Object.keys(incomingOpening).length && !same(currentOpening, incomingOpening)) collisions.push({ domain: "opening-balance", entityId: "singleton", source });
  if (!Object.keys(openingBalance).length) openingBalance = incomingOpening;
  return { value: { ...candidate, ...current, openingBalance, journalFlights: journal.all, officialAscensions: ascensions.all }, journalAdditions: journal.additions, ascensionAdditions: ascensions.additions };
}

function open(factory: IDBFactory, name: string, stores: readonly string[] = []): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = factory.open(name, 1); request.onupgradeneeded = () => { for (const store of stores) if (!request.result.objectStoreNames.contains(store)) { const created = request.result.createObjectStore(store, { keyPath: store === "activeFlight" ? "key" : store === BALLOON_DOCUMENT_FILES_STORE ? "documentId" : "id" }); if (store === BALLOON_DOCUMENTS_STORE) created.createIndex("balloonId", "balloonId", { unique: false }); } }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); }); }
function transactionDone(value: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { value.oncomplete = () => resolve(); value.onerror = () => reject(value.error); value.onabort = () => reject(value.error); }); }

async function copyIndexedDbCollection(input: Readonly<{ factory: IDBFactory; manifest: GuestImportManifest; destination: string; store: string; domain: "flight" | "document"; collisions: GuestToUserMigrationCollision[]; outbox: MigrationOutbox; relatedFileStore?: string; assertCurrent: () => void }>): Promise<number> {
  const entries = input.manifest.entries.filter(e => e.kind === input.domain);
  if (!entries.length) return 0;
  input.assertCurrent();
  const destination = await open(input.factory, input.destination, [input.store, ...(input.relatedFileStore ? [input.relatedFileStore] : []), ...(input.domain === "flight" ? ["activeFlight"] : [])]);
  try {
    input.assertCurrent();
    const known = await request(destination.transaction(input.store, "readonly").objectStore(input.store).getAll()) as Record<string, unknown>[];
    input.assertCurrent(); let imported = 0;
    for (const entry of entries) {
      input.assertCurrent(); const value = entry.value;
      const plan = selectAbsentMigrationRecords(known, [value]);
      for (const id of plan.conflicts) input.collisions.push({ domain: input.domain === "flight" ? "flight" : "balloon-document", entityId: id, source: entry.source });
      if (!plan.additions.length) continue;
      await input.outbox.enqueue({ entityType: input.domain === "flight" ? "flight" : "balloon-document", entityId: String(value.id), operation: "UPSERT", baseRevision: 0 });
      input.assertCurrent();
      const tx = destination.transaction([input.store, ...(input.relatedFileStore ? [input.relatedFileStore] : [])], "readwrite");
      tx.objectStore(input.store).add(value);
      if (entry.file && input.relatedFileStore) tx.objectStore(input.relatedFileStore).add(entry.file);
      await transactionDone(tx); input.assertCurrent(); known.push(value); imported += 1;
    }
    return imported;
  } finally { destination.close(); }
}

async function hasHistoricalEvidence(storage: Storage, factory: IDBFactory, manifest: GuestImportManifest, names: Set<string>, claims: readonly GuestImportClaim[], assertCurrent: () => void): Promise<boolean> {
  for (const key of [GUEST_TO_USER_MIGRATION_KEY, "balloon-companion-auth-legacy-migration-completions-v1"]) {
    const raw = storage.getItem(key); if (raw === null) continue;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_IMPORT_HISTORY");
    if (Object.values(value).some(row => !row || typeof row !== "object" || !(row as Marker).manifestId)) return true;
  }
  // Exact singleton content or stable IDs expose possible copies before checkpoint.
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index); if (!key?.startsWith("balloon-companion-user-data-v1:")) continue;
    for (const entry of manifest.entries.filter(e => ["singleton", "list", "opening", "journal", "ascension"].includes(e.kind))) {
      if (!key.endsWith(`:${entry.key}`)) continue;
      const value = object(JSON.parse(storage.getItem(key)!));
      const accountId = decodeURIComponent(key.slice("balloon-companion-user-data-v1:".length).split(":")[0]!);
      const explained = claims.some(claim => claim.userId === accountId && claim.manifest.entries.some(e => e.key === entry.key && e.kind === entry.kind));
      // An old copy may have been edited after a crash before its first marker.
      // Known manifest provenance permits later independent singleton versions.
      if (entry.kind === "singleton" && !explained && meaningful(LISTS.some(([, candidate]) => candidate === entry.key) ? value.profile : value)) return true;
      if (entry.kind === "opening" && !explained && meaningful(value.openingBalance)) return true;
      const list = LISTS.find(([, candidate]) => candidate === entry.key);
      const property = list?.[2] ?? (entry.kind === "journal" ? "journalFlights" : "officialAscensions");
      if (entry.kind !== "singleton" && records(value, property).some(item => item.id === entry.value.id || (entry.kind === "journal" && journalIdentity(item) === journalIdentity(entry.value)))) return true;
      if (entry.kind === "opening" && await fingerprint(value.openingBalance) === await fingerprint(entry.value)) return true;
      assertCurrent();
    }
  }
  for (const [base, store, kind] of [[RECORDED_FLIGHT_DB_NAME, RECORDED_FLIGHTS_STORE, "flight"], [BALLOON_DOCUMENT_DB_NAME, BALLOON_DOCUMENTS_STORE, "document"]] as const) {
    const ids = new Set(manifest.entries.filter(e => e.kind === kind).map(e => e.value.id));
    for (const name of names) {
      if (!name.startsWith(`${base}:user:`) || !ids.size) continue;
      assertCurrent(); const db = await openExistingGuestSource(factory, name);
      try { const rows = await readSourceRows(db, store); assertCurrent(); if (rows.some(row => ids.has(row.id))) return true; }
      finally { db.close(); }
    }
  }
  return false;
}

export async function migrateGuestAndLegacyToUser(input: Readonly<{ userId: string; deviceId: string; storage: Storage; factory?: IDBFactory; outbox?: MigrationOutbox; signal?: AbortSignal }>): Promise<GuestToUserMigrationReport> {
  const scope = `USER:${input.userId}` as const, generation = getRuntimeDataScopeGeneration();
  const assertCurrent = () => {
    if (input.signal?.aborted || getRuntimeDataScope() !== scope || getRuntimeDataScopeGeneration() !== generation) throw new Error("IMPORT_OBSOLETE");
  };
  const report = (state: GuestToUserMigrationReport["state"]): GuestToUserMigrationReport => ({
    state: input.signal?.aborted || getRuntimeDataScope() !== scope || getRuntimeDataScopeGeneration() !== generation ? "OBSOLETE" : state,
    imported: 0, collisions: [], completedDomains: [],
  });
  let manifest: GuestImportManifest;
  let accountCollisions: GuestToUserMigrationCollision[] = [];
  try {
    assertCurrent();
    if (!input.factory) throw new Error("CLAIM_STORAGE_UNAVAILABLE");
    const claims = await readGuestImportClaims(input.factory, assertCurrent);
    const stored = markers(input.storage);
    accountCollisions = Object.values(stored).filter(marker => marker.userId === input.userId && claims.some(claim => claim.userId === input.userId && claim.id === marker.manifestId)).flatMap(marker => marker.collisions);
    accountCollisions = accountCollisions.filter((collision, index, all) => all.findIndex(item => item.domain === collision.domain && item.entityId === collision.entityId && item.source === collision.source) === index);
    const resumable = claims.find(claim => claim.userId === input.userId && !stored[markerId(input.userId, input.deviceId, claim.id)]?.completedAt);
    if (resumable) manifest = resumable.manifest;
    else {
      const inspection = await inspectGuestSources(input.storage, input.factory, assertCurrent);
      const occupied = new Set(claims.flatMap(claim => claim.manifest.entries.map(e => e.identity)));
      const available = inspection.entries.filter(e => !occupied.has(e.identity));
      if (!available.length) {
        assertCurrent();
        const completedClaim = claims.find(claim => claim.userId === input.userId);
        if (completedClaim) {
          const previous = stored[markerId(input.userId, input.deviceId, completedClaim.id)];
          return previous ? { state: accountCollisions.length ? "COMPLETE_WITH_COLLISIONS" : "COMPLETE", imported: 0, collisions: accountCollisions, completedDomains: previous.completedDomains, manifestId: completedClaim.id } : report("COMPLETE");
        }
        return report(inspection.state === "EMPTY_VALID" ? "COMPLETE" : "CLAIMED_OTHER");
      }
      manifest = await makeGuestManifest(available); assertCurrent();
      const decision = getLocalDataMigrationDecision(input.storage, input.userId, input.deviceId, manifest.id);
      if (await hasHistoricalEvidence(input.storage, input.factory, manifest, inspection.names, claims, assertCurrent)) {
        if (decision?.decision === "MIGRATION_DEFERRED") return { ...report("DEFERRED"), manifestId: manifest.id };
        if (decision?.decision !== "MIGRATION_APPROVED") return { ...report("REVIEW_REQUIRED"), manifestId: manifest.id };
      }
      if (decision?.decision === "MIGRATION_DEFERRED") return { ...report(decision.manifestId === manifest.id ? "DEFERRED" : "REVIEW_REQUIRED"), manifestId: manifest.id };
      const verified = await inspectGuestSources(input.storage, input.factory, assertCurrent);
      if (verified.signature !== inspection.signature) return report("SOURCE_CHANGED");
      const acquired = await acquireGuestImportClaim(input.factory, manifest, input.userId, input.deviceId, assertCurrent);
      assertCurrent();
      if (acquired.state !== "OWNED") return report(acquired.state === "STALE_MANIFEST" ? "SOURCE_CHANGED" : "CLAIMED_OTHER");
      manifest = acquired.claim!.manifest;
      const final = await inspectGuestSources(input.storage, input.factory, assertCurrent);
      if (final.signature !== inspection.signature) return report("SOURCE_CHANGED");
    }
    assertCurrent();
    const decision = getLocalDataMigrationDecision(input.storage, input.userId, input.deviceId, manifest.id);
    if (decision?.decision === "MIGRATION_DEFERRED") return { ...report(decision.manifestId === manifest.id ? "DEFERRED" : "REVIEW_REQUIRED"), manifestId: manifest.id };
  } catch (error) { return report(error instanceof Error && error.message === "IMPORT_OBSOLETE" ? "OBSOLETE" : error instanceof Error && error.message === "SOURCE_OWNERSHIP_UNVERIFIABLE" ? "REVIEW_REQUIRED" : "IMPORT_BLOCKED"); }
  const outbox = input.outbox ?? new IndexedDbSyncOutboxStorage(scope);
  if (outbox.getScope && outbox.getScope() !== scope) return report("IMPORT_BLOCKED");
  const previous = markers(input.storage)[markerId(input.userId, input.deviceId, manifest.id)];
  const enqueue: MigrationOutbox["enqueue"] = async (mutation) => { assertCurrent(); const result = await outbox.enqueue(mutation); assertCurrent(); return result; };
  const guardedOutbox = { enqueue };
  const sourceValues = (_storage: Storage, key: string) => manifestSourceValues(manifest, key);
  const completed = new Set(previous?.completedDomains ?? []), collisions = accountCollisions.filter(c => c.reason !== "DUPLICATE_REGISTRATION" || !previous?.collisions.some(old => old.reason === c.reason && old.domain === c.domain && old.entityId === c.entityId && old.source === c.source)); let imported = 0;
  const incomingBalloons = sourceValues(input.storage, "balloon-companion-balloons").flatMap(source => records(parsed(source.raw), "balloons"));
  const registrationIds = new Map<string, Set<string>>();
  for (const item of incomingBalloons) {
    if (typeof item.registration !== "string") continue;
    const key = balloonRegistrationKey(item.registration), ids = registrationIds.get(key) ?? new Set<string>();
    ids.add(String(item.id)); registrationIds.set(key, ids);
  }
  const checkpoint = (domain: string) => { assertCurrent(); completed.add(domain); saveMarker(input.storage, { userId: input.userId, deviceId: input.deviceId, completedDomains: [...completed], collisions, manifestId: manifest.id }); };

  try {
    for (const [entityType, key] of SINGLETONS) {
      assertCurrent();
      if (completed.has(key)) continue;
      const destinationKey = scopedBusinessStorageKey(scope, key); let destination = input.storage.getItem(destinationKey);
      for (const source of sourceValues(input.storage, key)) {
        if (Object.keys(object(parsed(source.raw))).length === 0) continue;
        if (emptySingleton(entityType, destination)) { await enqueue({ entityType, entityId: "singleton", operation: "UPSERT", baseRevision: 0 }); input.storage.setItem(destinationKey, source.raw); destination = source.raw; imported += 1; }
        else if (!same(parsed(destination), parsed(source.raw))) collisions.push({ domain: entityType, entityId: "singleton", source: source.source });
      }
      checkpoint(key);
    }
    for (const [entityType, key, property] of LISTS) {
      assertCurrent();
      if (completed.has(key)) continue;
      const destinationKey = scopedBusinessStorageKey(scope, key); let destination = parsed(input.storage.getItem(destinationKey));
      for (const source of sourceValues(input.storage, key)) {
        let incoming = parsed(source.raw);
        if (entityType === "balloon") {
          const existing = records(destination, property);
          const accepted = records(incoming, property).filter(item => {
            if (typeof item.registration !== "string") return true;
            const key = balloonRegistrationKey(item.registration);
            const duplicate = (registrationIds.get(key)?.size ?? 0) > 1 || existing.some(other => other.id !== item.id && typeof other.registration === "string" && balloonRegistrationKey(other.registration) === key);
            if (duplicate) collisions.push({ domain: "balloon", entityId: String(item.id), source: source.source, reason: "DUPLICATE_REGISTRATION" });
            return !duplicate;
          });
          incoming = { ...object(incoming), [property]: accepted };
        }
        const result = mergeList(destination, incoming, property, entityType ?? "pilot-qualifications", source.source, collisions);
        if (!entityType && object(parsed(source.raw)).profile) {
          const incomingProfile = object(parsed(source.raw)).profile, currentProfile = object(destination).profile;
          if (!meaningful(currentProfile)) result.value.profile = incomingProfile;
          else if (!same(currentProfile, incomingProfile)) collisions.push({ domain: "pilot-qualifications-profile", entityId: "singleton", source: source.source });
        }
        if (result.additions.length || (!entityType && object(parsed(source.raw)).profile)) {
          if (entityType) for (const item of result.additions) await enqueue({ entityType, entityId: String(item.id), operation: "UPSERT", baseRevision: 0 });
          destination = result.value; input.storage.setItem(destinationKey, JSON.stringify(destination)); imported += result.additions.length;
        }
      }
      if (entityType !== "balloon" || !collisions.some(c => c.reason === "DUPLICATE_REGISTRATION")) checkpoint(key);
    }
    if (!completed.has(FLIGHT_COMPLETION_STORAGE_KEY)) {
      const destinationKey = scopedBusinessStorageKey(scope, FLIGHT_COMPLETION_STORAGE_KEY); let destination = parsed(input.storage.getItem(destinationKey));
      for (const source of sourceValues(input.storage, FLIGHT_COMPLETION_STORAGE_KEY)) {
        const sourceValue = parsed(source.raw), sourceRecord = object(sourceValue);
        if (!sourceRecord.openingBalance || !Array.isArray(sourceRecord.journalFlights) || !Array.isArray(sourceRecord.officialAscensions)) continue;
        const result = mergeCompletion(destination, sourceValue, source.source, collisions);
        if (result.journalAdditions.length || result.ascensionAdditions.length || !same(object(destination).openingBalance, result.value.openingBalance) || !input.storage.getItem(destinationKey)) {
          await enqueue({ entityType: "flight-completion", entityId: "singleton", operation: "UPSERT", baseRevision: 0 });
          for (const item of result.journalAdditions) await enqueue({ entityType: "flight", entityId: journalIdentity(item), operation: "UPSERT", baseRevision: 0 });
          for (const item of result.ascensionAdditions) await enqueue({ entityType: "logbook-entry", entityId: String(item.id), operation: "UPSERT", baseRevision: 0 });
          destination = result.value; input.storage.setItem(destinationKey, JSON.stringify(destination)); imported += result.journalAdditions.length + result.ascensionAdditions.length;
        }
      }
      checkpoint(FLIGHT_COMPLETION_STORAGE_KEY);
    }
    if (!completed.has(FLIGHT_SESSION_KEY)) {
      const destinationKey = scopedBusinessStorageKey(scope, FLIGHT_SESSION_KEY); let destination = input.storage.getItem(destinationKey);
      for (const source of sourceValues(input.storage, FLIGHT_SESSION_KEY)) {
        const sourceRecord = object(parsed(source.raw)); if (!Array.isArray(sourceRecord.points) || typeof sourceRecord.status !== "string") continue;
        if (destination === null) { input.storage.setItem(destinationKey, source.raw); destination = source.raw; imported += 1; }
        else if (!same(parsed(destination), parsed(source.raw))) collisions.push({ domain: "flight-session", entityId: "current", source: source.source });
      }
      checkpoint(FLIGHT_SESSION_KEY);
    }
    if (input.factory) {
      assertCurrent();
      if (!completed.has("recorded-flights")) {
        imported += await copyIndexedDbCollection({ factory: input.factory, manifest, destination: scopedIndexedDbName(scope, RECORDED_FLIGHT_DB_NAME), store: RECORDED_FLIGHTS_STORE, domain: "flight", collisions, outbox: guardedOutbox, assertCurrent }); checkpoint("recorded-flights");
      }
      if (!completed.has("documents")) {
        imported += await copyIndexedDbCollection({ factory: input.factory, manifest, destination: scopedIndexedDbName(scope, BALLOON_DOCUMENT_DB_NAME), store: BALLOON_DOCUMENTS_STORE, relatedFileStore: BALLOON_DOCUMENT_FILES_STORE, domain: "document", collisions, outbox: guardedOutbox, assertCurrent }); checkpoint("documents");
      }
    }
    assertCurrent();
    const marker = { manifestId: manifest.id, userId: input.userId, deviceId: input.deviceId, completedDomains: [...completed], collisions, ...(collisions.some(c => c.reason === "DUPLICATE_REGISTRATION") ? {} : { completedAt: new Date().toISOString() }) };
    saveMarker(input.storage, marker);
    return { state: collisions.some(c => c.reason === "DUPLICATE_REGISTRATION") ? "REVIEW_REQUIRED" : collisions.length ? "COMPLETE_WITH_COLLISIONS" : "COMPLETE", imported, collisions, completedDomains: marker.completedDomains, manifestId: manifest.id };
  } catch (error) {
    if (error instanceof Error && error.message === "IMPORT_OBSOLETE") return report("OBSOLETE");
    throw error;
  }
}
