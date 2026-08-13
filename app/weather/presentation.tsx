import { CircleHelp, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from "lucide-react";
import type { NormalizedWeatherCode } from "../lib/weather/openMeteo/types";

type IconKind = "sun" | "sun-cloud" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "storm" | "unknown";
export const WEATHER_ICON_KIND: Record<NormalizedWeatherCode, IconKind> = {
  CLEAR: "sun", MAINLY_CLEAR: "sun-cloud", PARTLY_CLOUDY: "sun-cloud", OVERCAST: "cloud",
  FOG: "fog", RIME_FOG: "fog",
  LIGHT_DRIZZLE: "drizzle", MODERATE_DRIZZLE: "drizzle", DENSE_DRIZZLE: "drizzle", LIGHT_FREEZING_DRIZZLE: "drizzle", DENSE_FREEZING_DRIZZLE: "drizzle",
  LIGHT_RAIN: "rain", MODERATE_RAIN: "rain", HEAVY_RAIN: "rain", LIGHT_FREEZING_RAIN: "rain", HEAVY_FREEZING_RAIN: "rain",
  LIGHT_SNOW: "snow", MODERATE_SNOW: "snow", HEAVY_SNOW: "snow", SNOW_GRAINS: "snow", LIGHT_SNOW_SHOWERS: "snow", HEAVY_SNOW_SHOWERS: "snow",
  LIGHT_RAIN_SHOWERS: "rain", MODERATE_RAIN_SHOWERS: "rain", VIOLENT_RAIN_SHOWERS: "rain",
  THUNDERSTORM: "storm", THUNDERSTORM_LIGHT_HAIL: "storm", THUNDERSTORM_HEAVY_HAIL: "storm", UNKNOWN: "unknown",
};
const ICONS = { sun: Sun, "sun-cloud": CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning, unknown: CircleHelp };

export function WeatherIcon({ code, size = 24, className }: { code: NormalizedWeatherCode; size?: number; className?: string }) {
  const Icon = ICONS[WEATHER_ICON_KIND[code]];
  return <Icon className={className} size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export const WEATHER_LABELS: Record<NormalizedWeatherCode, string> = { CLEAR: "Ciel dégagé", MAINLY_CLEAR: "Principalement dégagé", PARTLY_CLOUDY: "Peu nuageux", OVERCAST: "Couvert", FOG: "Brouillard", RIME_FOG: "Brouillard givrant", LIGHT_DRIZZLE: "Bruine faible", MODERATE_DRIZZLE: "Bruine modérée", DENSE_DRIZZLE: "Bruine forte", LIGHT_FREEZING_DRIZZLE: "Bruine verglaçante faible", DENSE_FREEZING_DRIZZLE: "Bruine verglaçante forte", LIGHT_RAIN: "Pluie faible", MODERATE_RAIN: "Pluie modérée", HEAVY_RAIN: "Pluie forte", LIGHT_FREEZING_RAIN: "Pluie verglaçante faible", HEAVY_FREEZING_RAIN: "Pluie verglaçante forte", LIGHT_SNOW: "Neige faible", MODERATE_SNOW: "Neige modérée", HEAVY_SNOW: "Neige forte", SNOW_GRAINS: "Neige en grains", LIGHT_RAIN_SHOWERS: "Averses faibles", MODERATE_RAIN_SHOWERS: "Averses modérées", VIOLENT_RAIN_SHOWERS: "Averses violentes", LIGHT_SNOW_SHOWERS: "Averses de neige faibles", HEAVY_SNOW_SHOWERS: "Averses de neige fortes", THUNDERSTORM: "Orage", THUNDERSTORM_LIGHT_HAIL: "Orage avec faible grêle", THUNDERSTORM_HEAVY_HAIL: "Orage avec forte grêle", UNKNOWN: "Conditions inconnues" };
