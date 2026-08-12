export type WeatherIconKind = "clear-day" | "clear-night" | "partly-cloudy" | "cloudy" | "overcast" | "fog" | "rain" | "heavy-rain" | "thunderstorm" | "snow";

export type WeatherPlace = { name: string; detail?: string };
export type SunTimes = { sunrise: string; sunset: string };
export type HourlyWeather = { id: string; time: string; icon: WeatherIconKind; temperature: string; windDirection: string; windSpeed: string; gusts: string };
export type MetarReading = { observedAt?: string; wind?: string; visibility?: string; phenomena?: string; ceiling?: string; temperature?: string; dewPoint?: string; qnh?: string; raw?: string };
export type TafReading = { periods: readonly string[]; raw?: string };

export type WeatherPageData = {
  weatherPlace: WeatherPlace | null;
  aviationStation: WeatherPlace | null;
  sunTimes: SunTimes | null;
  hourly: readonly HourlyWeather[];
  metar: MetarReading | null;
  taf: TafReading | null;
};
