import { loadAviationStationLocations } from "../../../lib/aviation/airportSearch.ts";
import { isFlightDossierWeatherRequest } from "../../../lib/flightDossierWeather.ts";
import { prepareMoroccoDossierWeather } from "../../../lib/moroccoDossierWeather.ts";

export const maxDuration = 30;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const input: unknown = await request.json().catch(() => null);
  if (!isFlightDossierWeatherRequest(input) || !("availabilityReferenceAt" in input) || typeof input.availabilityReferenceAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(input.availabilityReferenceAt) || !Number.isFinite(Date.parse(input.availabilityReferenceAt)))
    return Response.json({ error: "Référence UTC ou échéances météo Maroc invalides." }, { status: 400, headers });
  const data = await prepareMoroccoDossierWeather({ ...input, availabilityReferenceAt: new Date(input.availabilityReferenceAt).toISOString() }, {
    stations: () => loadAviationStationLocations(undefined, Date.now(), 8_000),
  });
  return Response.json({ data }, { headers });
}
