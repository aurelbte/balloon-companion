import { loadAviationStationLocations } from "./aviation/airportSearch.ts";
import { loadAviationWeather } from "./aviation/aviationWeather.ts";
import { prepareFlightDossierWeather, type DossierWeatherServices } from "./flightDossierWeather.ts";
import type { MultiAltitudeProjectionSuccess } from "./trajectory/integration.ts";
import type { CalculationAviation } from "./moroccoWeatherCapture.ts";

/** Supplement the normal calculation, never reload its wind or use the writing date. */
export async function captureCalculationAviation(result: MultiAltitudeProjectionSuccess, services: Pick<DossierWeatherServices, "stations" | "aviation"> = {
  stations: () => loadAviationStationLocations(undefined, Date.now(), 8_000),
  aviation: airport => loadAviationWeather({ airport, timeoutMs: 8_000 }),
}): Promise<CalculationAviation[]> {
  const projections = [...result.layerProjections.map(p => p.projection), ...(result.flightProfileProjection ? [result.flightProfileProjection] : [])];
  const location = (p: typeof projections[number]["points"][number]) => ({ latitude: p.latitude, longitude: p.longitude, timestamp: p.timestamp });
  const unique = new Map(projections.map(p => [JSON.stringify([location(p.points[0]), location(p.points.at(-1)!)]), p]));
  let stations: ReturnType<typeof services.stations> | undefined;
  const bulletins = new Map<string, ReturnType<typeof services.aviation>>();
  return Promise.all([...unique.values()].map(async projection => {
    const departure = location(projection.points[0]), landing = location(projection.points.at(-1)!);
    const weather = await prepareFlightDossierWeather({ traceId: "calculation-aviation", weatherModel: result.moroccoCalculation!.request.weatherModel, departure, landing }, {
      stations: () => stations ??= services.stations(),
      aviation: airport => {
        if (!bulletins.has(airport)) bulletins.set(airport, services.aviation(airport));
        return bulletins.get(airport)!;
      },
      altitude: async () => { throw new Error("Vent déjà acquis par le calcul."); },
      ground: async () => { throw new Error("Vent d’arrivée acquis séparément au point calculé."); },
    });
    return { departure, landing, data: weather.aviation };
  }));
}
