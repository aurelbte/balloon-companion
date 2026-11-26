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
  calculationAviation?: CalculationAviation[];
  calculationFailures?: import("./trajectory/integration.ts").AltitudeProjectionFailure[];
};

/** Original bulletins and their real receipt times, bound to a calculated endpoint. */
export type CalculationAviation = {
  departure: import("./flightDossierWeather.ts").DossierLocation;
  landing: import("./flightDossierWeather.ts").DossierLocation;
  data: FlightDossierWeather["aviation"];
};
