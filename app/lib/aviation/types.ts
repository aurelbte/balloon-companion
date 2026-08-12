export type AviationWeatherStatus = "AVAILABLE" | "PARTIAL" | "STALE" | "UNAVAILABLE";

export type AviationWeather = {
  airport: string;
  metarRaw: string | null;
  tafRaw: string | null;
  metarIssuedAt: string | null;
  tafIssuedAt: string | null;
  /** Heure réelle de récupération auprès de la source. */
  sourceUpdatedAt: string;
  status: AviationWeatherStatus;
};

export type AviationWeatherResult =
  | { data: AviationWeather; error: null }
  | { data: null; error: { code: "NO_AIRPORT" | "NO_DATA" | "SOURCE_UNAVAILABLE"; message: string } };
