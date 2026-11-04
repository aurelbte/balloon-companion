import type { GroundTemperature } from "./loadPerformance/types.ts";

/** Manual choice never falls back to auto, even if empty or awaiting correction. */
export function resolveLoadGroundTemperature(
  mode: "auto" | "manual",
  manualInput: string,
  automatic: GroundTemperature | null,
  validAt?: string | null,
): GroundTemperature | null {
  if (mode === "auto") return automatic;
  const text = manualInput.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
  const temperatureC = Number(text.replace(",", "."));
  if (!Number.isFinite(temperatureC)) return null;
  return { temperatureC, sourceModel: "Saisie manuelle", provider: "Saisie manuelle", forecastRun: "", validTime: validAt ?? "" };
}
