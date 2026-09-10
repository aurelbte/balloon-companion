import { getRuntimeDataScope } from "./auth/dataScopeRuntime.ts";

type PreparationValue = "draft" | "request" | "projection" | "analysis" | "exports";
// Deliberately memory-only: sessionStorage can survive an iPhone/PWA relaunch.
// Persistent values remain available as caches, never as an implicit new session.
const currentValues = new Map<string, Map<PreparationValue, string>>();

export function startNewPreparationSession(): void {
  const scope = getRuntimeDataScope();
  if (scope) currentValues.delete(scope);
}

export function rememberPreparationValue(kind: PreparationValue, value: unknown): void {
  const scope = getRuntimeDataScope();
  if (!scope || typeof window === "undefined") return;
  let values = currentValues.get(scope);
  if (!values) { values = new Map(); currentValues.set(scope, values); }
  if (kind === "request") { values.delete("analysis"); values.delete("exports"); }
  values.set(kind, JSON.stringify(value));
}

export function currentPreparationValue<T>(kind: PreparationValue, value: T): T | null {
  const scope = getRuntimeDataScope();
  return scope && value != null && currentValues.get(scope)?.get(kind) === JSON.stringify(value)
    ? value : null;
}
