import type { MultiAltitudeProjectionSuccess } from "./trajectory/integration.ts";
import type { OpenMeteoClient } from "./weather/openMeteo/types.ts";
import type { MoroccoRawForecast } from "./moroccoWeatherCapture.ts";

/** Acquisition during preparation only. No run/publication time is inferred from reception. */
export async function captureMoroccoArrivalWeather(result: MultiAltitudeProjectionSuccess, client: OpenMeteoClient, endpoint: string): Promise<{ rawForecasts: MoroccoRawForecast[]; notices: string[] }> {
  const request = result.moroccoCalculation!.request;
  const projections = [...result.layerProjections.map(p => p.projection), ...(result.flightProfileProjection ? [result.flightProfileProjection] : [])];
  const arrivals = new Map(projections.map(projection => {
    const point = projection.points.at(-1)!;
    return [JSON.stringify([point.latitude, point.longitude, point.timestamp]), point];
  }));
  const rows = await Promise.all([...arrivals.values()].map(async point => {
    const query = { latitude: point.latitude, longitude: point.longitude, weatherModel: request.weatherModel,
      startAt: new Date(Date.parse(request.launchDateTimeIso) - 2 * 3600000).toISOString(),
      endAt: new Date(Date.parse(point.timestamp) + 2 * 3600000).toISOString(), landingAt: point.timestamp };
    try {
      const payload = await client.fetchHourlyForecast(query);
      return { raw: { source: "Open-Meteo" as const, endpoint, kind: "ground" as const, model: request.weatherModel,
        query, receivedAt: new Date().toISOString(), payload }, notice: null };
    } catch {
      // Provider messages may contain URLs/credentials; retain only safe contextual information.
      return { raw: null, notice: `Vent à 10 m indisponible à l’arrivée ${point.latitude}, ${point.longitude}, ${point.timestamp} : acquisition échouée pendant la préparation.` };
    }
  }));
  return { rawForecasts: rows.flatMap(row => row.raw ? [row.raw] : []), notices: rows.flatMap(row => row.notice ? [row.notice] : []) };
}
