import type { FlightDossierWeather } from "./flightDossierWeather.ts";

export type MoroccoRawForecast = {
  source: "Open-Meteo";
  /** Credential-free endpoint; API keys are never persisted. */
  endpoint: string;
  kind: "altitude" | "ground" | "calculation";
  model: string;
  query: Record<string, string | number>;
  receivedAt: string;
  payload: unknown;
};
export type MoroccoWeatherCapture = {
  weather: FlightDossierWeather; rawForecasts: MoroccoRawForecast[];
  calculationRequest?: import("./trajectory/integration.ts").MultiAltitudeProjectionRequest;
  calculationFailures?: import("./trajectory/integration.ts").AltitudeProjectionFailure[];
};
