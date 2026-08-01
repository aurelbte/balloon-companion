import { createOpenMeteoClient, getOpenMeteoServerConfig } from "../../../lib/weather/openMeteo/client";
import { selectNearestGroundTemperature } from "../../../lib/weather/openMeteo/groundTemperatureSelection";

type TemperaturePayload = { hourly?: { time?: unknown; temperature_2m?: unknown } };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lon"));
  const validAt = params.get("validAt")?.trim();
  const weatherModel = params.get("weatherModel")?.trim();
  const target = validAt ? new Date(validAt) : null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !target || Number.isNaN(target.getTime()) || !weatherModel) {
    return Response.json({ error: { message: "lat, lon, validAt et weatherModel sont requis." } }, { status: 400 });
  }
  const selectedWeatherModel = weatherModel;
  const selectedValidAt = validAt!;
  try {
    const raw = await createOpenMeteoClient(getOpenMeteoServerConfig()).fetchGroundTemperature({ latitude, longitude, validAt: selectedValidAt, weatherModel: selectedWeatherModel }) as TemperaturePayload;
    const times = raw.hourly?.time;
    const values = raw.hourly?.temperature_2m;
    if (!Array.isArray(times) || !Array.isArray(values)) throw new Error("Réponse horaire Open-Meteo invalide.");
    const selected = selectNearestGroundTemperature(selectedValidAt, times, values);
    if (!selected) throw new Error("Aucune température horaire exploitable.");
    const fetchedAt = new Date().toISOString();
    return Response.json({ data: { temperatureC: selected.temperatureC, sourceModel: selectedWeatherModel, forecastRun: "Non communiqué par Open-Meteo", validTime: selected.validTime, forecastOffsetMinutes: selected.offsetMinutes, provider: "Open-Meteo", fetchedAt } });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : "Température au sol indisponible" } }, { status: 502 });
  }
}
