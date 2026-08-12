import type { NormalizedWeatherCode } from "../lib/weather/openMeteo/types";

type GlyphKind = "sun" | "sun-cloud" | "cloud" | "fog" | "rain" | "snow" | "storm";
const GLYPHS: Record<NormalizedWeatherCode, GlyphKind> = {
  CLEAR: "sun", MAINLY_CLEAR: "sun-cloud", PARTLY_CLOUDY: "sun-cloud", OVERCAST: "cloud",
  FOG: "fog", RIME_FOG: "fog",
  LIGHT_DRIZZLE: "rain", MODERATE_DRIZZLE: "rain", DENSE_DRIZZLE: "rain", LIGHT_FREEZING_DRIZZLE: "rain", DENSE_FREEZING_DRIZZLE: "rain",
  LIGHT_RAIN: "rain", MODERATE_RAIN: "rain", HEAVY_RAIN: "rain", LIGHT_FREEZING_RAIN: "rain", HEAVY_FREEZING_RAIN: "rain",
  LIGHT_SNOW: "snow", MODERATE_SNOW: "snow", HEAVY_SNOW: "snow", SNOW_GRAINS: "snow", LIGHT_SNOW_SHOWERS: "snow", HEAVY_SNOW_SHOWERS: "snow",
  LIGHT_RAIN_SHOWERS: "rain", MODERATE_RAIN_SHOWERS: "rain", VIOLENT_RAIN_SHOWERS: "rain",
  THUNDERSTORM: "storm", THUNDERSTORM_LIGHT_HAIL: "storm", THUNDERSTORM_HEAVY_HAIL: "storm", UNKNOWN: "cloud",
};

export function WeatherIcon({ code, size = 24, className }: { code: NormalizedWeatherCode; size?: number; className?: string }) {
  const kind = GLYPHS[code];
  return <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {(kind === "sun" || kind === "sun-cloud") && <><circle cx={kind === "sun" ? 24 : 17} cy={kind === "sun" ? 24 : 17} r="7" /><path d={kind === "sun" ? "M24 5v5M24 38v5M5 24h5M38 24h5M10.5 10.5l3.5 3.5M34 34l3.5 3.5M37.5 10.5L34 14M14 34l-3.5 3.5" : "M17 5v4M5 17h4M8.5 8.5l3 3M25.5 8.5l-3 3"} /></>}
    {kind !== "sun" && kind !== "fog" && <path d="M13 34h22a7 7 0 0 0 0-14 11 11 0 0 0-21-1A7.5 7.5 0 0 0 13 34Z" />}
    {kind === "fog" && <><path d="M12 27h24M8 33h32M14 39h20" /><path d="M15 22a9 9 0 0 1 17-3 6 6 0 0 1 5 3" /></>}
    {kind === "rain" && <path d="M17 38v4M24 38v4M31 38v4" />}
    {kind === "snow" && <><path d="M18 38v6M15.5 39.5l5 3M20.5 39.5l-5 3M30 38v6M27.5 39.5l5 3M32.5 39.5l-5 3" /></>}
    {kind === "storm" && <path d="M26 35l-5 7h5l-3 5" />}
  </svg>;
}

export const WEATHER_LABELS: Record<NormalizedWeatherCode, string> = { CLEAR: "Ciel dégagé", MAINLY_CLEAR: "Principalement dégagé", PARTLY_CLOUDY: "Peu nuageux", OVERCAST: "Couvert", FOG: "Brouillard", RIME_FOG: "Brouillard givrant", LIGHT_DRIZZLE: "Bruine faible", MODERATE_DRIZZLE: "Bruine modérée", DENSE_DRIZZLE: "Bruine forte", LIGHT_FREEZING_DRIZZLE: "Bruine verglaçante faible", DENSE_FREEZING_DRIZZLE: "Bruine verglaçante forte", LIGHT_RAIN: "Pluie faible", MODERATE_RAIN: "Pluie modérée", HEAVY_RAIN: "Pluie forte", LIGHT_FREEZING_RAIN: "Pluie verglaçante faible", HEAVY_FREEZING_RAIN: "Pluie verglaçante forte", LIGHT_SNOW: "Neige faible", MODERATE_SNOW: "Neige modérée", HEAVY_SNOW: "Neige forte", SNOW_GRAINS: "Neige en grains", LIGHT_RAIN_SHOWERS: "Averses faibles", MODERATE_RAIN_SHOWERS: "Averses modérées", VIOLENT_RAIN_SHOWERS: "Averses violentes", LIGHT_SNOW_SHOWERS: "Averses de neige faibles", HEAVY_SNOW_SHOWERS: "Averses de neige fortes", THUNDERSTORM: "Orage", THUNDERSTORM_LIGHT_HAIL: "Orage avec faible grêle", THUNDERSTORM_HEAVY_HAIL: "Orage avec forte grêle", UNKNOWN: "Conditions inconnues" };
