const SESSION_KEY = "balloon-companion:load-demo-enabled:v1";

/** Une activation explicite est conservée uniquement pendant la session de développement. */
export function resolveLoadDemoMode(search: string): boolean {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return false;
  const explicitlyRequested = new URLSearchParams(search).get("testLoad") === "1";
  if (explicitlyRequested) window.sessionStorage.setItem(SESSION_KEY, "1");
  return explicitlyRequested || window.sessionStorage.getItem(SESSION_KEY) === "1";
}

/** La marge synthétique exige les deux paramètres explicites et n'est jamais mémorisée. */
export function resolveSyntheticMarginMode(search: string, demoEnabled: boolean): boolean {
  const parameters = new URLSearchParams(search);
  return demoEnabled
    && parameters.get("testLoad") === "1"
    && parameters.get("showSyntheticMargin") === "1";
}

export function analysisPathWithLoadDemo(): string {
  return resolveLoadDemoMode(window.location.search) ? "/map?testLoad=1" : "/map";
}
