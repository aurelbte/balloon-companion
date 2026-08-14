const WIND_DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"] as const;

export function cockpitWindDirection(degrees: number | undefined): string {
  if (degrees === undefined || !Number.isFinite(degrees)) return "—";
  const normalized = ((degrees % 360) + 360) % 360;
  return `${WIND_DIRECTIONS[Math.round(normalized / 22.5) % 16]} · ${degrees}°`;
}

export function cockpitWindSpeed(speedKmh: number | undefined, unit: WeatherWindSpeedUnit = "km/h"): string {
  return speedKmh === undefined || !Number.isFinite(speedKmh) ? "—" : formatWeatherWind(speedKmh, unit);
}
import { formatWeatherWind, type WeatherWindSpeedUnit } from "../../lib/unitPreferences.ts";
