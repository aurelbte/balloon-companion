import { createOpenMeteoClient, getOpenMeteoServerConfig } from "../../../lib/weather/openMeteo/client";

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
    let selected = -1;
    let minimumDelta = Number.POSITIVE_INFINITY;
    times.forEach((time, index) => {
      if (typeof time !== "string" || typeof values[index] !== "number") return;
      const delta = Math.abs(new Date(`${time}Z`).getTime() - target.getTime());
      if (delta < minimumDelta) { selected = index; minimumDelta = delta; }
    });
    if (selected < 0 || minimumDelta > 30 * 60 * 1000) throw new Error("Échéance horaire indisponible.");
    const fetchedAt = new Date().toISOString();
    return Response.json({ data: { temperatureC: values[selected], sourceModel: selectedWeatherModel, forecastRun: "Non communiqué par Open-Meteo", validTime: `${times[selected]}Z`, fetchedAt } });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : "Température au sol indisponible" } }, { status: 502 });
  }
}
