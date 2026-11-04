import { loadAviationStationLocations } from "../../../lib/aviation/airportSearch.ts";
import { loadAviationWeather } from "../../../lib/aviation/aviationWeather.ts";
import { isFlightDossierWeatherRequest, prepareFlightDossierWeather } from "../../../lib/flightDossierWeather.ts";
import { createOpenMeteoClient, getOpenMeteoServerConfig } from "../../../lib/weather/openMeteo/client.ts";
import { parseHourlyForecast } from "../../../lib/weather/openMeteo/hourlyForecast.ts";
import { parseOpenMeteoWindColumn } from "../../../lib/weather/openMeteo/parser.ts";

export const maxDuration = 30;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const input: unknown = await request.json().catch(() => null);
  if (!isFlightDossierWeatherRequest(input)) return Response.json({ error: "Stratégie météo invalide (modèle, coordonnées ou horaires ; durée maximale 24 h)." }, { status: 400, headers });
  // Construct lazily so configuration failures are reported per weather section.
  const client = () => createOpenMeteoClient(getOpenMeteoServerConfig());
  const data = await prepareFlightDossierWeather(input, {
    stations: () => loadAviationStationLocations(undefined, Date.now(), 8_000),
    aviation: (airport) => loadAviationWeather({ airport, timeoutMs: 8_000 }),
    altitude: async (query) => {
      const payload = await client().fetchWindColumn(query);
      return { column: parseOpenMeteoWindColumn(payload, query.weatherModel, undefined, 0), fetchedAt: new Date().toISOString() };
    },
    ground: async (query) => parseHourlyForecast(await client().fetchHourlyForecast(query), query.weatherModel),
  });
  return Response.json({ data }, { headers });
}
