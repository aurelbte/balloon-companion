export type ScopedOfficialAscensionDraft<T> = {
  pathname: string;
  values: T;
  durationMinutes: string;
};

export function createScopedOfficialAscensionDraft<T>(
  pathname: string,
  values: T,
  durationMinutes: string,
): ScopedOfficialAscensionDraft<T> {
  return { pathname, values, durationMinutes };
}

export function parseScopedOfficialAscensionDraft<T>(
  raw: string | null,
  expectedPathname: string,
): ScopedOfficialAscensionDraft<T> | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<ScopedOfficialAscensionDraft<T>>;
    if (
      draft.pathname !== expectedPathname ||
      !draft.values ||
      typeof draft.values !== "object" ||
      typeof draft.durationMinutes !== "string"
    ) return null;
    return draft as ScopedOfficialAscensionDraft<T>;
  } catch {
    return null;
  }
}
