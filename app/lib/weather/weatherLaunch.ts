import { ANALYSIS_POLICY, classifyWeatherFreshness, type WeatherFreshness } from "./weatherFreshness.ts";
export function launchNeedsWeatherConfirmation(status: WeatherFreshness): boolean {
  return status === "EXPIRED" || status === "UNKNOWN";
}
/** A decision applies only to this attempt and this snapshot; no persistent permission. */
export async function authorizeWeatherLaunch<T extends { weatherFetchedAt?: string }>(options: {
  read(): T | null;
  refresh(): Promise<boolean>;
  online(): boolean;
  current(): boolean;
  confirm(snapshot: T | null, status: WeatherFreshness): Promise<boolean>;
  clock?: () => number;
}): Promise<{ allowed: boolean; snapshot: T | null; confirmed: boolean }> {
  const now = options.clock ?? Date.now;
  if (!options.current()) return { allowed: false, snapshot: null, confirmed: false };
  let snapshot = options.read();
  let status = classifyWeatherFreshness(now(), snapshot?.weatherFetchedAt, ANALYSIS_POLICY);
  if (status !== "FRESH" && options.online() && options.current()) {
    try { await options.refresh(); } catch { /* Previous data is still a reference. */ }
    if (!options.current()) return { allowed: false, snapshot: null, confirmed: false };
    snapshot = options.read();
    status = classifyWeatherFreshness(now(), snapshot?.weatherFetchedAt, ANALYSIS_POLICY);
  }
  const fingerprint = JSON.stringify(snapshot);
  let confirmed = false;
  if (launchNeedsWeatherConfirmation(status)) {
    confirmed = await options.confirm(snapshot, status);
    if (!confirmed) return { allowed: false, snapshot, confirmed: false };
  }
  const finalStatus = classifyWeatherFreshness(now(), snapshot?.weatherFetchedAt, ANALYSIS_POLICY);
  if (launchNeedsWeatherConfirmation(finalStatus) && !confirmed) {
    confirmed = await options.confirm(snapshot, finalStatus);
    if (!confirmed) return { allowed: false, snapshot, confirmed: false };
  }
  return { allowed: options.current() && fingerprint === JSON.stringify(options.read()), snapshot, confirmed };
}
