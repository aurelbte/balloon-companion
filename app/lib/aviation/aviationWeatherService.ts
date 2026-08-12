import type { AviationWeatherResult } from "./types.ts";

export async function loadAviationWeatherForAirport(airportIcao: string | null, signal?: AbortSignal): Promise<AviationWeatherResult> {
  if (!airportIcao) return { data: null, error: { code: "NO_AIRPORT", message: "Aucun aérodrome Aviation sélectionné." } };
  const response = await fetch(`/api/aviation/weather?airport=${encodeURIComponent(airportIcao)}`, { signal });
  const result = await response.json() as AviationWeatherResult;
  if (!response.ok && !result.error) return { data: null, error: { code: "SOURCE_UNAVAILABLE", message: "Les données aviation sont momentanément indisponibles." } };
  return result;
}
