import { manufacturerLoadAdapters } from "./adapters.ts";
import type { LoadCalculationInput, LoadCalculationResult } from "./types.ts";

const unavailable = (reasonCode: Extract<LoadCalculationResult, { status: "UNAVAILABLE" }>["reasonCode"], message: string): LoadCalculationResult => ({ status: "UNAVAILABLE", reasonCode, message });

export function calculateOfficialLoad(input: LoadCalculationInput): LoadCalculationResult {
  if (!input.balloonId || !input.manufacturer || !input.model) return unavailable("NO_BALLOON", "Sélectionnez un ballon.");
  if (!(typeof input.balloonEquipmentWeightKg === "number" && input.balloonEquipmentWeightKg > 0)) return unavailable("INCOMPLETE_BALLOON_MASSES", "Complétez les masses du ballon.");
  if (!(typeof input.occupantsWeightKg === "number" && input.occupantsWeightKg >= 0)) return unavailable("NO_OCCUPANTS_WEIGHT", "Renseignez Pilote + passagers.");
  if (!(typeof input.plannedMaximumAltitudeMslM === "number" && Number.isFinite(input.plannedMaximumAltitudeMslM))) return unavailable("NO_MAXIMUM_ALTITUDE", "Saisissez l’altitude maximale prévue.");
  if (!(typeof input.launchElevationMslM === "number" && Number.isFinite(input.launchElevationMslM))) return unavailable("NO_LAUNCH_ELEVATION", "Altitude du terrain indisponible.");
  if (input.plannedMaximumAltitudeMslM < input.launchElevationMslM) return unavailable("OUTSIDE_OFFICIAL_TABLE", "L’altitude maximale prévue est inférieure à l’altitude du terrain.");
  if (!input.temperatureProfile?.length) return unavailable("NO_TEMPERATURE_PROFILE", "Prévision de température indisponible.");
  const adapter = manufacturerLoadAdapters.find(
    (candidate) => candidate.manufacturer === input.manufacturer,
  );
  if (!adapter) return unavailable("UNSUPPORTED_MODEL", "Constructeur non pris en charge.");
  return adapter.calculate(input);
}

/** La marge affichée est arrondie vers le bas pour ne jamais embellir le résultat. */
export function displayLoadMarginKg(marginKg: number): number {
  return Math.floor(marginKg);
}

export const LOAD_MARGIN_PRESENTATION = { positiveComfortKg: 20 } as const;

export function loadMarginTone(marginKg: number): "positive" | "caution" | "negative" {
  if (marginKg < 0) return "negative";
  return marginKg < LOAD_MARGIN_PRESENTATION.positiveComfortKg ? "caution" : "positive";
}
