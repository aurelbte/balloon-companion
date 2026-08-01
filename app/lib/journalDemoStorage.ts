const JOURNAL_DEMO_STORAGE_KEY = "balloon-companion-journal-demo-deleted-v1";

export type JournalDemoState = {
  version: 2;
  deletedFlightIds: string[];
  customNames: Record<string, string>;
};

const EMPTY_STATE: JournalDemoState = {
  version: 2,
  deletedFlightIds: [],
  customNames: {},
};

function sanitizeState(
  value: unknown,
  availableIds: readonly string[],
): JournalDemoState {
  const available = new Set(availableIds);
  const deletedSource = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null &&
        Array.isArray((value as Partial<JournalDemoState>).deletedFlightIds)
      ? (value as Partial<JournalDemoState>).deletedFlightIds!
      : [];
  const deletedFlightIds = [...new Set(deletedSource)].filter(
    (id): id is string => typeof id === "string" && available.has(id),
  );
  const rawNames =
    !Array.isArray(value) &&
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<JournalDemoState>).customNames === "object" &&
    (value as Partial<JournalDemoState>).customNames !== null
      ? (value as Partial<JournalDemoState>).customNames!
      : {};
  const customNames = Object.fromEntries(
    Object.entries(rawNames).flatMap(([id, name]) => {
      if (!available.has(id) || typeof name !== "string" || !name.trim()) {
        return [];
      }
      return [[id, name.trim()]];
    }),
  );
  return { version: 2, deletedFlightIds, customNames };
}

export function loadJournalDemoState(
  availableIds: readonly string[],
): JournalDemoState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(JOURNAL_DEMO_STORAGE_KEY) ?? "null",
    );
    return sanitizeState(value, availableIds);
  } catch {
    return EMPTY_STATE;
  }
}

/** Point de remplacement unique pour les futures mutations IndexedDB. */
export function saveJournalDemoState(state: JournalDemoState): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(JOURNAL_DEMO_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
