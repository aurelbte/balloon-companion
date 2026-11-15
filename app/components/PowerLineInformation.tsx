"use client";

import { useEffect, useState } from "react";
import type { PreparationPowerLineState } from "../lib/preparationPowerLines";
import { preparationPowerLineStatusLabel } from "../lib/tiledPowerLineStatus";

export const POWER_LINE_WARNING_MS = 8000;
export function powerLineWarningKey(state: PreparationPowerLineState | null): string {
  if (!state || (state.covered && !state.offline) || (state.loading && !state.offline)) return "";
  const errors = [...new Set(state.tileDiagnostics?.filter(t => !["AVAILABLE", "EMPTY", "OUTSIDE_COVERAGE", "LOADING", "NOT_LOADED"].includes(t.status)).map(t => t.status))].sort();
  return [state.offline ? "OFFLINE" : "UNCOVERED", ...errors].join(":");
}

/** Short notification only; the information control always retains the complete current diagnostic. */
export function PowerLineWarning({ enabled, state }: { enabled: boolean; state: PreparationPowerLineState | null }) {
  const key = enabled ? powerLineWarningKey(state) : "";
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    setDismissed(null);
    if (!key) return;
    const timer = window.setTimeout(() => setDismissed(key), POWER_LINE_WARNING_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
  if (!key || dismissed === key) return null;
  return <p role="status" className="m-0 rounded border border-amber-400/50 bg-amber-50/95 px-2 py-1 text-[11px] text-amber-950">
    Lignes électriques : couverture indisponible ou incomplète. Consultez ⓘ près du filtre. Ne présumez pas l’absence de lignes.
  </p>;
}

export function PowerLineInformation({ state, above = false }: { state: PreparationPowerLineState | null; above?: boolean }) {
  const warning = Boolean(powerLineWarningKey(state));
  return <details className="relative inline-block shrink-0 text-left text-xs">
    <summary aria-label={warning ? "Informations lignes électriques — avertissement" : "Informations lignes électriques"} className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg" style={{ color: warning ? "#d97706" : "inherit" }}>
      <span aria-hidden="true">ⓘ{warning ? " !" : ""}</span>
    </summary>
    <div className={`absolute right-0 z-50 max-h-48 w-64 max-w-[calc(100vw-32px)] overflow-auto rounded-xl border border-slate-300 bg-white p-3 text-xs text-slate-900 shadow-lg ${above ? "bottom-full mb-1" : "top-full mt-1"}`}>
      <p className="m-0">{state ? preparationPowerLineStatusLabel(state) : "Couverture non vérifiée. Activez le filtre pour charger la zone visible."}</p>
      <p className="mb-0 mt-2">© OpenStreetMap contributors · Geofabrik. Lignes aériennes ≥ 63 kV uniquement. Données non exhaustives : une zone vide ou non chargée ne garantit jamais l’absence de lignes électriques. Vérifiez le terrain et les sources officielles.</p>
    </div>
  </details>;
}
