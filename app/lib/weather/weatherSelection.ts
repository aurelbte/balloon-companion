import type { WeatherHourlyPoint } from "./openMeteo/types.ts";

export function dayKey(timestamp: string): string { return timestamp.slice(0, 10); }
export function timeKey(timestamp: string): string { return timestamp.slice(11, 16); }
export function availableDays(points: readonly WeatherHourlyPoint[]): string[] { return [...new Set(points.map(({ timestamp }) => dayKey(timestamp)))]; }
export function availableTimes(points: readonly WeatherHourlyPoint[], day: string): string[] { return points.filter(({ timestamp }) => dayKey(timestamp) === day).map(({ timestamp }) => timeKey(timestamp)); }
export function closestAvailableDay(days: readonly string[], preferred: string): string | undefined {
  if (days.length === 0) return undefined;
  if (days.includes(preferred)) return preferred;
  const target = Date.parse(`${preferred}T12:00:00`);
  return [...days].sort((left, right) => Math.abs(Date.parse(`${left}T12:00:00`) - target) - Math.abs(Date.parse(`${right}T12:00:00`) - target))[0];
}
export function closestAvailableTime(times: readonly string[], preferred: string | undefined): string | undefined {
  if (times.length === 0) return undefined;
  if (!preferred || times.includes(preferred)) return preferred ?? times[0];
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return [...times].sort((left, right) => Math.abs(minutes(left) - minutes(preferred)) - Math.abs(minutes(right) - minutes(preferred)))[0];
}
export function relativeUpdateLabel(sourceUpdatedAt: string, now = Date.now()): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(sourceUpdatedAt)) / 60_000));
  if (elapsedMinutes < 1) return "à l’instant";
  if (elapsedMinutes === 1) return "il y a 1 min";
  if (elapsedMinutes < 60) return `il y a ${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  return hours === 1 ? "il y a 1 h" : `il y a ${hours} h`;
}
