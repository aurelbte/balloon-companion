export const LOW_STORAGE_MINIMUM_FREE_BYTES = 50 * 1024 * 1024;
export const LOW_STORAGE_MINIMUM_FREE_RATIO = 0.1;

export type StoragePersistenceState =
  | "CHECKING"
  | "GRANTED"
  | "NOT_GRANTED"
  | "UNAVAILABLE"
  | "UNVERIFIABLE";
export type StorageEstimateState =
  | "CHECKING"
  | "AVAILABLE"
  | "INCOMPLETE"
  | "UNAVAILABLE"
  | "UNVERIFIABLE";
export type OfflineReadinessState =
  | "CHECKING"
  | "READY"
  | "FAILED"
  | "UNAVAILABLE";

export type StorageEstimateSnapshot = Readonly<{
  state: StorageEstimateState;
  usage?: number;
  quota?: number;
  remaining?: number;
  low: boolean;
}>;

export type StorageResilienceSnapshot = Readonly<{
  persistence: StoragePersistenceState;
  estimate: StorageEstimateSnapshot;
  offline: OfflineReadinessState;
}>;

type StorageManagerAccess = Readonly<{
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<StorageEstimate>;
}>;

const INITIAL_SNAPSHOT: StorageResilienceSnapshot = {
  persistence: "CHECKING",
  estimate: { state: "CHECKING", low: false },
  offline: "CHECKING",
};
let snapshot = INITIAL_SNAPSHOT;
let persistenceRequest: Promise<StoragePersistenceState> | null = null;
let estimateGeneration = 0;
const listeners = new Set<() => void>();

function publish(next: StorageResilienceSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function browserStorageManager(): StorageManagerAccess | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.storage;
}

export function storageResilienceSnapshot(): StorageResilienceSnapshot {
  return snapshot;
}

export function subscribeStorageResilience(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestPersistentStorageOnce(
  storage: StorageManagerAccess | undefined = browserStorageManager(),
): Promise<StoragePersistenceState> {
  persistenceRequest ??= (async () => {
    if (!storage || typeof storage.persisted !== "function") return "UNAVAILABLE";
    try {
      if (await storage.persisted()) return "GRANTED";
      if (typeof storage.persist !== "function") return "UNAVAILABLE";
      return (await storage.persist()) ? "GRANTED" : "NOT_GRANTED";
    } catch {
      return "UNVERIFIABLE";
    }
  })();
  void persistenceRequest.then((persistence) => publish({ ...snapshot, persistence }));
  return persistenceRequest;
}

export async function inspectStorageEstimate(
  storage: StorageManagerAccess | undefined = browserStorageManager(),
): Promise<StorageEstimateSnapshot> {
  if (!storage || typeof storage.estimate !== "function") {
    return { state: "UNAVAILABLE", low: false };
  }
  try {
    const estimate = await storage.estimate();
    const usage = estimate.usage;
    const quota = estimate.quota;
    if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota === undefined || quota <= 0 || usage === undefined || usage < 0 || usage > quota) {
      return { state: "INCOMPLETE", low: false };
    }
    const remaining = Math.max(0, quota - usage);
    const warningThreshold = Math.max(
      LOW_STORAGE_MINIMUM_FREE_BYTES,
      quota * LOW_STORAGE_MINIMUM_FREE_RATIO,
    );
    return { state: "AVAILABLE", usage, quota, remaining, low: remaining < warningThreshold };
  } catch {
    return { state: "UNVERIFIABLE", low: false };
  }
}

export async function refreshStorageEstimate(
  storage: StorageManagerAccess | undefined = browserStorageManager(),
): Promise<StorageEstimateSnapshot> {
  const generation = ++estimateGeneration;
  const estimate = await inspectStorageEstimate(storage);
  if (generation === estimateGeneration) publish({ ...snapshot, estimate });
  return estimate;
}

export function initializeStorageResilience(
  storage: StorageManagerAccess | undefined = browserStorageManager(),
): void {
  void requestPersistentStorageOnce(storage);
  void refreshStorageEstimate(storage);
}

export function setOfflineReadiness(offline: OfflineReadinessState): void {
  publish({ ...snapshot, offline });
}

export function persistenceStatusLabel(state: StoragePersistenceState): string {
  switch (state) {
    case "GRANTED": return "Persistance accordée par le navigateur, sans garantie absolue";
    case "NOT_GRANTED": return "Persistance non accordée par le navigateur";
    case "UNAVAILABLE": return "API de persistance indisponible";
    case "UNVERIFIABLE": return "Persistance impossible à vérifier";
    default: return "Vérification de la persistance…";
  }
}

export function storageEstimateWarning(
  estimate: StorageEstimateSnapshot,
  requiredBytes = 0,
): string | null {
  if (estimate.state === "CHECKING") return "Espace de stockage en cours de vérification.";
  if (estimate.state !== "AVAILABLE" || estimate.remaining === undefined) {
    return "Espace de stockage non vérifiable. L’écriture réelle reste déterminante.";
  }
  if (estimate.low || estimate.remaining < requiredBytes) {
    return "Espace de stockage local faible. L’enregistrement peut échouer.";
  }
  return null;
}

export function offlineReadinessLabel(state: OfflineReadinessState): string {
  switch (state) {
    case "READY": return "Mode hors ligne prêt, sans garantie de conservation permanente";
    case "FAILED": return "Installation du mode hors ligne échouée";
    case "UNAVAILABLE": return "Mode hors ligne indisponible dans ce contexte";
    default: return "Vérification du mode hors ligne…";
  }
}

export function resetStorageResilienceForTests(): void {
  snapshot = INITIAL_SNAPSHOT;
  persistenceRequest = null;
  estimateGeneration = 0;
  listeners.clear();
}
