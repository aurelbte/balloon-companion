import { classifyWeatherFreshness, HOURLY_POLICY } from "./weatherFreshness.ts";
import { loadHourlyWeatherForecast } from "./hourlyForecastService.ts";
import type { WeatherHourlyForecast } from "./openMeteo/types.ts";
export type HourlyRuntimeState = { data: WeatherHourlyForecast | null; loading: boolean; error: boolean; now: number };
export const WEATHER_REFRESH_BACKOFF_MS = 60_000;
/** One runtime per captured query; cleanup rejects late responses and queued callbacks. */
export function startHourlyForecastRuntime(query: Parameters<typeof loadHourlyWeatherForecast>[0], publish: (state: HourlyRuntimeState) => void, current: () => boolean = () => true, load = loadHourlyWeatherForecast) {
  const eventWindow = window, eventDocument = document;
  let state: HourlyRuntimeState = { data: null, loading: false, error: false, now: Date.now() };
  let stopped = false, inFlight = false, nextAttempt = 0, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const valid = () => !stopped && current();
  const emit = () => { if (valid()) publish(state); };
  const schedule = () => {
    clearTimeout(timer);
    if (!valid()) return;
    const now = Date.now(), fetched = state.data ? Date.parse(state.data.sourceUpdatedAt) : NaN;
    const boundaries = [fetched + HOURLY_POLICY.fresh + 1, fetched + HOURLY_POLICY.expired + 1].filter(time => time > now && Number.isFinite(time));
    if (navigator.onLine && !inFlight && classifyWeatherFreshness(now, state.data?.sourceUpdatedAt, HOURLY_POLICY) !== "FRESH") boundaries.push(Math.max(now + 1, nextAttempt));
    if (boundaries.length) timer = setTimeout(() => { void refresh(); }, Math.min(...boundaries) - now);
  };
  async function refresh(force = false) {
    if (!valid()) return;
    state = { ...state, now: Date.now() }; emit();
    const necessary = force || !state.data || classifyWeatherFreshness(state.now, state.data.sourceUpdatedAt, HOURLY_POLICY) !== "FRESH";
    if (inFlight || !necessary || Date.now() < nextAttempt) { schedule(); return; }
    if (!navigator.onLine) { state = { ...state, error: true }; emit(); schedule(); return; }
    inFlight = true; state = { ...state, loading: true }; emit();
    schedule(); // Age transitions must continue even if this request hangs.
    try {
      const data = await load(query, controller.signal);
      if (!valid()) return;
      failures = 0;
      state = { data, loading: false, error: false, now: Date.now() };
    } catch {
      if (!valid()) return;
      failures += 1;
      state = { ...state, loading: false, error: true, now: Date.now() };
    } finally {
      inFlight = false;
      nextAttempt = Date.now() + (failures ? Math.min(15 * 60_000, WEATHER_REFRESH_BACKOFF_MS * 2 ** Math.min(failures - 1, 4)) : 5 * 60_000);
      emit(); schedule();
    }
  }
  const visible = () => { if (eventDocument.visibilityState === "visible") void refresh(); };
  void refresh();
  const eventRefresh = () => { void refresh(); };
  eventWindow.addEventListener("focus", eventRefresh); eventWindow.addEventListener("pageshow", eventRefresh); eventWindow.addEventListener("online", eventRefresh);
  eventDocument.addEventListener("visibilitychange", visible);
  return { retry: () => { if (!inFlight) { nextAttempt = 0; void refresh(true); } }, stop: () => { stopped = true; controller.abort(); clearTimeout(timer); eventWindow.removeEventListener("focus", eventRefresh); eventWindow.removeEventListener("pageshow", eventRefresh); eventWindow.removeEventListener("online", eventRefresh); eventDocument.removeEventListener("visibilitychange", visible); } };
}
