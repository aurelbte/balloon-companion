import { validateMultiAltitudeProjectionRequest } from "../../../lib/trajectory/integration";
import type { MoroccoRawForecast } from "../../../lib/moroccoWeatherCapture";
import { captureCalculationAviation } from "../../../lib/moroccoCalculationAviation";
import { captureMoroccoArrivalWeather } from "../../../lib/moroccoArrivalWeather";
import { orchestrateMultiAltitudeProjection } from "../../../lib/trajectory/multiProjectionServer";
import { OpenMeteoWindProvider } from "../../../lib/weather/openMeteo/adapter";
import {
  createOpenMeteoClient,
  getOpenMeteoServerConfig,
} from "../../../lib/weather/openMeteo/client";
import { parseOpenMeteoElevation } from "../../../lib/weather/openMeteo/parser";

// Calculation plus bounded supplemental acquisitions; the numerical engine is unchanged.
export const maxDuration = 60;

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Le corps JSON de la requête est invalide.",
        },
      },
      { status: 400 },
    );
  }

  const retrievals: string[] = [];
  const config = getOpenMeteoServerConfig();
  const baseClient = createOpenMeteoClient(config);
  const rawForecasts: MoroccoRawForecast[] = [];
  const client = { ...baseClient, async fetchWindColumn(query: Parameters<typeof baseClient.fetchWindColumn>[0]) {
    const raw = await baseClient.fetchWindColumn(query);
    rawForecasts.push({ source: "Open-Meteo", endpoint: config.tier === "commercial" ? "https://customer-api.open-meteo.com/v1/forecast" : "https://api.open-meteo.com/v1/forecast", kind: "calculation", model: query.weatherModel, query: { ...query }, receivedAt: new Date().toISOString(), payload: raw });
    return raw;
  } };
  const result = await orchestrateMultiAltitudeProjection(payload, {
    async getTerrainAltitude(latitude, longitude) {
      return parseOpenMeteoElevation(
        await client.fetchElevation(latitude, longitude),
      );
    },
    createWindProvider(terrainAltitudeAmslM) {
      return new OpenMeteoWindProvider(client, terrainAltitudeAmslM, timestamp => retrievals.push(timestamp));
    },
  });
  if (result.body.ok && retrievals.length) result.body.weatherFetchedAt = retrievals.sort()[0];
  if (result.body.ok) {
    result.body.moroccoCalculation = { request: validateMultiAltitudeProjectionRequest(payload), rawForecasts };
    const [arrival, aviation] = await Promise.all([
      captureMoroccoArrivalWeather(result.body, baseClient, config.tier === "commercial" ? "https://customer-api.open-meteo.com/v1/forecast" : "https://api.open-meteo.com/v1/forecast"),
      captureCalculationAviation(result.body).catch(() => []),
    ]);
    result.body.moroccoCalculation.rawForecasts.push(...arrival.rawForecasts);
    result.body.moroccoCalculation.notices = arrival.notices;
    result.body.moroccoCalculation.aviation = aviation;
  }
  return Response.json(result.body, { status: result.status });
}
