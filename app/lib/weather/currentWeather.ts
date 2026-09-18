import { hourlyTimeToTimestamp } from "./openMeteo/groundTemperatureSelection.ts";
import type { WeatherHourlyPoint } from "./openMeteo/types.ts";

// Hourly samples represent the nearest hour, never more than half a step away.
const HALF_HOUR = 30 * 60_000;
export type CurrentWeatherSelection = { point: WeatherHourlyPoint | null; validAt: number | null };

export function currentWeatherSelection(points: readonly WeatherHourlyPoint[], timezone: string | undefined, now: number) {
  const samples = points.flatMap(point => {
    try {
      // Without a forecast zone, only explicitly zoned timestamps are usable.
      if (!timezone && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(point.timestamp)) return [];
      const time = hourlyTimeToTimestamp(point.timestamp, timezone ?? "UTC");
      return Number.isFinite(time) ? [{ point, time }] : [];
    } catch { return []; }
  });
  const eligible = samples.filter(({ time }) => now >= time - HALF_HOUR && now < time + HALF_HOUR);
  eligible.sort((a, b) => Math.abs(a.time - now) - Math.abs(b.time - now) || b.time - a.time);
  const selected = eligible[0];
  const boundaries = samples.flatMap(({ time }) => [time - HALF_HOUR, time + HALF_HOUR]).filter(time => time > now);
  return {
    selection: { point: selected?.point ?? null, validAt: selected?.time ?? null } as CurrentWeatherSelection,
    nextAt: boundaries.length ? Math.min(...boundaries) : null,
  };
}

/** One timeout at the next sample boundary; foreground events repair frozen timers. */
export function watchCurrentWeather(points: readonly WeatherHourlyPoint[], timezone: string | undefined, publish: (value: CurrentWeatherSelection) => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (stopped) return;
    clearTimeout(timer);
    const now = Date.now();
    const { selection, nextAt } = currentWeatherSelection(points, timezone, now);
    publish(selection);
    if (nextAt !== null) timer = setTimeout(refresh, Math.min(nextAt - now, 2_147_483_647));
  };
  const visible = () => { if (document.visibilityState === "visible") refresh(); };
  refresh();
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
  };
}
