const ASCENSION_DEMO_STORAGE_KEY = "balloon-companion-ascension-demo-v1";

export type AscensionDemoState = {
  version: 1;
  deletedIds: string[];
  customTitles: Record<string, string>;
};

const EMPTY_STATE: AscensionDemoState = {
  version: 1,
  deletedIds: [],
  customTitles: {},
};

function sanitizeState(value: unknown, availableIds: readonly string[]): AscensionDemoState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY_STATE;
  const source = value as Partial<AscensionDemoState>;
  const available = new Set(availableIds);
  const deletedIds = Array.isArray(source.deletedIds)
    ? [...new Set(source.deletedIds)].filter(
        (id): id is string => typeof id === "string" && available.has(id),
      )
    : [];
  const customTitles = Object.fromEntries(
    Object.entries(source.customTitles ?? {}).flatMap(([id, title]) =>
      available.has(id) && typeof title === "string" && title.trim()
        ? [[id, title.trim()]]
        : [],
    ),
  );
  return { version: 1, deletedIds, customTitles };
}

export function loadAscensionDemoState(availableIds: readonly string[]): AscensionDemoState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    return sanitizeState(
      JSON.parse(window.localStorage.getItem(ASCENSION_DEMO_STORAGE_KEY) ?? "null"),
      availableIds,
    );
  } catch {
    return EMPTY_STATE;
  }
}

export function saveAscensionDemoState(state: AscensionDemoState): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(ASCENSION_DEMO_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
