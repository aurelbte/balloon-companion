import type { FavoriteLaunchSite } from "../favoriteLaunchSites.ts";
import type { AviationWeatherResult } from "./types.ts";

export async function loadAviationWeatherForFavorite(favorite: FavoriteLaunchSite | null, signal?: AbortSignal): Promise<AviationWeatherResult> {
  if (!favorite?.icaoCode) return { data: null, error: { code: "NO_AIRPORT", message: "Aucun aérodrome associé au favori météo." } };
  const response = await fetch(`/api/aviation/weather?airport=${encodeURIComponent(favorite.icaoCode)}`, { signal });
  const result = await response.json() as AviationWeatherResult;
  if (!response.ok && !result.error) return { data: null, error: { code: "SOURCE_UNAVAILABLE", message: "Les données aviation sont momentanément indisponibles." } };
  return result;
}
