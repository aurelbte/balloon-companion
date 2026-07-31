const DELETED_FLIGHTS_KEY = "balloon-companion-journal-demo-deleted-v1";

export function loadDeletedDemoFlightIds(
  availableIds: readonly string[],
): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(DELETED_FLIGHTS_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    const available = new Set(availableIds);
    return [...new Set(value)].filter(
      (id): id is string => typeof id === "string" && available.has(id),
    );
  } catch {
    return [];
  }
}

/** Point de remplacement unique pour la future suppression IndexedDB. */
export function persistDeletedDemoFlightIds(ids: readonly string[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(DELETED_FLIGHTS_KEY, JSON.stringify([...ids]));
    return true;
  } catch {
    return false;
  }
}
