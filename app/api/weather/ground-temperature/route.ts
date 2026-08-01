import { createOpenMeteoClient, getOpenMeteoServerConfig } from "../../../lib/weather/openMeteo/client";
import { hourlyTimeToTimestamp, selectNearestGroundTemperature } from "../../../lib/weather/openMeteo/groundTemperatureSelection";
import { TrajectoryDomainError } from "../../../lib/trajectory/types";

type TemperaturePayload = { hourly?: { time?: unknown; temperature_2m?: unknown } };
const TIMEZONE = "Europe/Paris";

type GroundTemperatureErrorCode = "INVALID_COORDINATES" | "INVALID_DATE_TIME" | "DATE_OUTSIDE_FORECAST_RANGE" | "OPEN_METEO_HTTP_ERROR" | "INVALID_OPEN_METEO_RESPONSE" | "NO_HOURLY_TEMPERATURE" | "ALL_VALUES_INVALID";

function failure(reasonCode: GroundTemperatureErrorCode, message: string, status: number, details?: unknown) {
  return Response.json({ ok: false, reasonCode, message, ...(process.env.NODE_ENV === "development" && details !== undefined ? { details } : {}) }, { status });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawLatitude = params.get("lat");
  const rawLongitude = params.get("lon");
  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);
  const validAt = params.get("validAt")?.trim();
  const weatherModel = params.get("weatherModel")?.trim();
  const target = validAt ? new Date(validAt) : null;
  if (!rawLatitude || !rawLongitude || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return failure("INVALID_COORDINATES", "Coordonnées du terrain invalides.", 400);
  if (!target || Number.isNaN(target.getTime())) return failure("INVALID_DATE_TIME", "Date ou heure du vol invalide.", 400);
  if (!weatherModel) return failure("INVALID_OPEN_METEO_RESPONSE", "Modèle météo absent de la préparation.", 400);
  const selectedWeatherModel = weatherModel;
  const selectedValidAt = validAt!;
  if (process.env.NODE_ENV === "development") console.info("[ground-weather] request", { latitude, longitude, requestedTime: selectedValidAt, timezone: TIMEZONE });
  try {
    const raw = await createOpenMeteoClient(getOpenMeteoServerConfig()).fetchGroundTemperature({ latitude, longitude, validAt: selectedValidAt, weatherModel: selectedWeatherModel }) as TemperaturePayload;
    const times = raw.hourly?.time;
    const values = raw.hourly?.temperature_2m;
    if (!Array.isArray(times) || !Array.isArray(values)) return failure("INVALID_OPEN_METEO_RESPONSE", "Réponse horaire Open-Meteo invalide.", 502);
    if (times.length === 0 || values.length === 0) return failure("NO_HOURLY_TEMPERATURE", "Aucune température horaire reçue.", 422);
    const validTimestamps = times.filter((time): time is string => typeof time === "string").map((time) => hourlyTimeToTimestamp(time, TIMEZONE)).filter(Number.isFinite).sort((a, b) => a - b);
    if (validTimestamps.length === 0) return failure("INVALID_OPEN_METEO_RESPONSE", "Les échéances Open-Meteo sont invalides.", 502);
    if (target.getTime() < validTimestamps[0] || target.getTime() > validTimestamps.at(-1)!) return failure("DATE_OUTSIDE_FORECAST_RANGE", "Prévision de température indisponible pour cette date.", 422, { firstTime: new Date(validTimestamps[0]).toISOString(), lastTime: new Date(validTimestamps.at(-1)!).toISOString() });
    const selected = selectNearestGroundTemperature(selectedValidAt, times, values, TIMEZONE);
    if (!selected) return failure("ALL_VALUES_INVALID", "Aucune température horaire numérique exploitable.", 422);
    const fetchedAt = new Date().toISOString();
    if (process.env.NODE_ENV === "development") console.info("[ground-weather] response", { count: times.length, firstTime: times[0], lastTime: times.at(-1), selectedTime: selected.validTime, temperatureC: selected.temperatureC });
    return Response.json({ ok: true, temperatureC: selected.temperatureC, validTime: selected.validTime, requestedTime: selectedValidAt, offsetMinutes: selected.offsetMinutes, sourceModel: "Open-Meteo", timezone: TIMEZONE, forecastRun: "Non communiqué par Open-Meteo", provider: "Open-Meteo", fetchedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Le service Open-Meteo est indisponible.";
    const isRange = /forecast days|past days|date.*range|out of range/i.test(message);
    const reasonCode = isRange ? "DATE_OUTSIDE_FORECAST_RANGE" : "OPEN_METEO_HTTP_ERROR";
    if (process.env.NODE_ENV === "development") console.error("[ground-weather] failure", { reasonCode, message, details: error instanceof TrajectoryDomainError ? error.details : undefined });
    return failure(reasonCode, isRange ? "Prévision de température indisponible pour cette date." : message, isRange ? 422 : 502, error instanceof TrajectoryDomainError ? error.details : undefined);
  }
}
