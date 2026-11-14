import { powerLineStatusLabel } from "./powerLinesRuntime.ts";
import type { PreparationPowerLineState } from "./preparationPowerLines.ts";

/** Lightweight label helper: importing this must not load country indexes. */
export function preparationPowerLineStatusLabel(state: PreparationPowerLineState): string {
  if (state.localCoverage) return [state.coverageLabel, state.loading ? "Chargement des tuiles…" : "", state.offline ? "Hors ligne" : ""].filter(Boolean).join(" · ");
  return [state.coverageLabel, powerLineStatusLabel(state)].filter(Boolean).join(" · ");
}
