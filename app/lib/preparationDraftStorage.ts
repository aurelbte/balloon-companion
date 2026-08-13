import {
  migrateStoredPreparation,
  type StoredFlightPreparationV2,
} from "./flightStorage.ts";
import { readScopedBusinessValue, removeScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";

export const PREPARATION_DRAFT_STORAGE_KEY =
  "balloon-companion-preparation-draft";

export function loadPreparationDraft(): StoredFlightPreparationV2 | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = readScopedBusinessValue(window.sessionStorage, PREPARATION_DRAFT_STORAGE_KEY);
    return raw ? migrateStoredPreparation(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePreparationDraft(
  preparation: StoredFlightPreparationV2,
): boolean {
  if (typeof window === "undefined") return false;

  const validated = migrateStoredPreparation(preparation);
  if (!validated) return false;

  try {
    return writeScopedBusinessValue(window.sessionStorage, PREPARATION_DRAFT_STORAGE_KEY, JSON.stringify(validated));
  } catch {
    return false;
  }
}

export function clearPreparationDraft(): void {
  if (typeof window === "undefined") return;
  removeScopedBusinessValue(window.sessionStorage, PREPARATION_DRAFT_STORAGE_KEY);
}
