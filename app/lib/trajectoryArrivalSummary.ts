import type { WeatherHourlyForecast, WeatherHourlyPoint } from "./weather/openMeteo/types.ts";
import type { WeatherAnalysisTrace } from "./trajectory/weatherAnalysisStorage.ts";

export const LANDING_WEATHER_RADIUS_M = 3_000;

export type LandingWeatherSummary = {
  averageWindKmh: number | null;
  maximumWindKmh: number | null;
  maximumGustKmh: number | null;
  directionLabel: string;
};

const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"] as const;
type Cardinal = (typeof CARDINALS)[number];
const radians = (value: number) => value * Math.PI / 180;

export function landingWeatherSamplePoints(latitude: number, longitude: number) {
  const earthRadiusM = 6_371_000;
  return [null, 0, 45, 90, 135, 180, 225, 270, 315].map((bearing) => {
    if (bearing === null) return { latitude, longitude };
    const angular = LANDING_WEATHER_RADIUS_M / earthRadiusM;
    const latitudeRad = radians(latitude);
    const bearingRad = radians(bearing);
    const sampledLatitude = Math.asin(Math.sin(latitudeRad) * Math.cos(angular) + Math.cos(latitudeRad) * Math.sin(angular) * Math.cos(bearingRad));
    const sampledLongitude = radians(longitude) + Math.atan2(Math.sin(bearingRad) * Math.sin(angular) * Math.cos(latitudeRad), Math.cos(angular) - Math.sin(latitudeRad) * Math.sin(sampledLatitude));
    return { latitude: sampledLatitude * 180 / Math.PI, longitude: sampledLongitude * 180 / Math.PI };
  });
}

function timestampMs(value: string): number {
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
}

function nearestPoint(forecast: WeatherHourlyForecast, etaIso: string): WeatherHourlyPoint | null {
  const eta = timestampMs(etaIso);
  const nearest = forecast.points.reduce<WeatherHourlyPoint | null>((candidate, point) =>
    !candidate || Math.abs(timestampMs(point.timestamp) - eta) < Math.abs(timestampMs(candidate.timestamp) - eta) ? point : candidate, null);
  return nearest && Math.abs(timestampMs(nearest.timestamp) - eta) <= 90 * 60_000 ? nearest : null;
}

function cardinal(degrees: number): Cardinal {
  return CARDINALS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

export function summarizeLandingWeather(forecasts: readonly WeatherHourlyForecast[], etaIso: string): LandingWeatherSummary {
  const points = forecasts.map((forecast) => nearestPoint(forecast, etaIso)).filter((point): point is WeatherHourlyPoint => point !== null);
  const winds = points.map(({ windSpeedKmh }) => windSpeedKmh).filter((value): value is number => value !== undefined);
  const gusts = points.map(({ windGustKmh }) => windGustKmh).filter((value): value is number => value !== undefined);
  const directions = [...new Set(points.map(({ windDirectionDeg }) => windDirectionDeg === undefined ? null : cardinal(windDirectionDeg)).filter((value): value is Cardinal => value !== null))];
  return {
    averageWindKmh: winds.length ? winds.reduce((sum, value) => sum + value, 0) / winds.length : null,
    maximumWindKmh: winds.length ? Math.max(...winds) : null,
    maximumGustKmh: gusts.length ? Math.max(...gusts) : null,
    directionLabel: directions.length === 0 ? "—" : directions.length === 1 ? directions[0] : `${directions[0]} → ${directions.at(-1)}`,
  };
}

export function trajectoryDistanceKm(trace: WeatherAnalysisTrace): number {
  let meters = 0;
  for (let index = 1; index < trace.projection.points.length; index += 1) {
    const previous = trace.projection.points[index - 1];
    const current = trace.projection.points[index];
    const latitudeDelta = radians(current.latitude - previous.latitude);
    const longitudeDelta = radians(current.longitude - previous.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(previous.latitude)) * Math.cos(radians(current.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
    meters += 2 * 6_371_000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return meters / 1_000;
}

export function trajectoryMaximumWindKmh(trace: WeatherAnalysisTrace): number | null {
  const values = trace.projection.points.flatMap((point) => point.windUsed ? [point.windUsed.speedMps * 3.6] : []);
  return values.length ? Math.max(...values) : null;
}
