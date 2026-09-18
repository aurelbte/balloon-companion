"use client";
import { useEffect, useState } from "react";
import { classifyWeatherFreshness, type FreshnessPolicy } from "../lib/weather/weatherFreshness";
/** Qualifies historical data without changing or fetching it. */
export function useWeatherFreshness(fetchedAt: string | undefined, policy: FreshnessPolicy) {
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (stopped) return;
      clearTimeout(timer);
      const now = Date.now();
      setClock(now);
      const fetched = fetchedAt ? Date.parse(fetchedAt) : NaN;
      const next = [fetched + policy.fresh + 1, fetched + policy.expired + 1].find(time => time > now);
      if (next !== undefined && Number.isFinite(fetched) && fetched <= now) timer = setTimeout(refresh, next - now);
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    timer = setTimeout(refresh, 0);
    window.addEventListener("focus", refresh); window.addEventListener("pageshow", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [fetchedAt, policy]);
  return classifyWeatherFreshness(clock ?? NaN, fetchedAt, policy);
}
