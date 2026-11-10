import { resolveMoroccoDossierReference, type MoroccoDossierReference } from "./moroccoDossierReference.ts";
import type { FlightDossierResult } from "./flightDossierEntry.ts";
import type { FlightDossierWeather, FlightDossierWeatherRequest } from "./flightDossierWeather.ts";

/** Called only by the dossier button, never by strategy selection or rendering. */
export async function loadFlightDossierWeather(
  dossier: Extract<FlightDossierResult, { status: "READY" }>["data"],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FlightDossierWeather> {
  const first = dossier.points[0];
  const last = dossier.points.at(-1)!;
  const location = (point: typeof first) => ({ latitude: point.latitude, longitude: point.longitude, timestamp: point.timestamp });
  const input: FlightDossierWeatherRequest = { traceId: dossier.traceId, weatherModel: dossier.model.providerModelId, departure: location(first), landing: location(last) };
  const response = await fetchImpl("/api/preparation/flight-dossier-weather", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || !payload.data || payload.data.traceId !== dossier.traceId || payload.data.weatherModel !== dossier.model.providerModelId) throw new Error(payload.error ?? "Données météo du dossier indisponibles.");
  return payload.data;
}

/** Morocco only: the reference bounds source availability, never forecast validity. */
export async function loadMoroccoFlightDossierWeather(
  dossier: Extract<FlightDossierResult, { status: "READY" }>["data"],
  reference?: MoroccoDossierReference,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<FlightDossierWeather> {
  const availabilityReferenceAt = resolveMoroccoDossierReference(dossier, reference).iso;
  return loadFlightDossierWeather(dossier, signal, async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    const response = await fetchImpl("/api/preparation/morocco-dossier-weather", { ...init, body: JSON.stringify({ ...input, availabilityReferenceAt }) });
    if (response.ok && (await response.clone().json()).data?.availabilityReferenceAt !== availabilityReferenceAt) throw new Error("Référence de disponibilité météo Maroc incohérente.");
    return response;
  });
}
