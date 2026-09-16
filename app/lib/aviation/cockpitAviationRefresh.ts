import { AVIATION_REFRESH_MS } from "./aviationFreshness.ts";
import { loadAviationWeatherForAirport } from "./aviationWeatherService.ts";
import type { AviationWeatherResult } from "./types.ts";

/** Rafraîchissement borné, sans requêtes concurrentes, arrêté au démontage. */
export function startCockpitAviationRefresh(
  airport: string,
  callbacks: { onResult(result: AviationWeatherResult): void; onFailure(): void; onClock(now: number): void },
  load = loadAviationWeatherForAirport,
): () => void {
  let disposed = false;
  let pending: AbortController | null = null;
  const refresh = async () => {
    if (disposed) return;
    callbacks.onClock(Date.now());
    if (pending) return;
    const controller = new AbortController();
    pending = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await load(airport, controller.signal);
      if (!disposed) { callbacks.onResult(result); callbacks.onClock(Date.now()); }
    } catch {
      if (!disposed) callbacks.onFailure();
    } finally {
      window.clearTimeout(timeout);
      pending = null;
    }
  };
  const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
  const initial = window.setTimeout(() => { void refresh(); }, 0);
  const refreshTimer = window.setInterval(() => { void refresh(); }, AVIATION_REFRESH_MS);
  const ageTimer = window.setInterval(() => callbacks.onClock(Date.now()), 60_000);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    disposed = true;
    pending?.abort();
    window.clearTimeout(initial);
    window.clearInterval(refreshTimer);
    window.clearInterval(ageTimer);
    window.removeEventListener("online", refresh);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
