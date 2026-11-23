import type { MultiAltitudeProjectionRequest } from "./trajectory/integration.ts";
import { readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";

/** Explicit document destination; never infer it from coordinates, aircraft or a weather model. */
export function moroccoPreparationIntentKey(request: MultiAltitudeProjectionRequest): string {
  return `bc:morocco-intent:v1:${JSON.stringify([request.launchSite.latitude, request.launchSite.longitude, request.launchDateTimeIso, request.durationSeconds])}`;
}
export function readMoroccoPreparationIntent(request: MultiAltitudeProjectionRequest, storage?: Storage): boolean {
  try { return readScopedBusinessValue(storage ?? sessionStorage, moroccoPreparationIntentKey(request)) === "true"; } catch { return false; }
}
export function saveMoroccoPreparationIntent(request: MultiAltitudeProjectionRequest, enabled: boolean, storage?: Storage): boolean {
  try { return writeScopedBusinessValue(storage ?? sessionStorage, moroccoPreparationIntentKey(request), JSON.stringify(enabled)); } catch { return false; }
}
export function moroccoCalculationAcquisitionOptions(explicitlyMorocco: boolean) {
  // Retain departure capture for existing local archives; extra arrival calls require this explicit opt-in.
  return { archiveMoroccoWeather: true, acquireMoroccoArrivalWeather: explicitlyMorocco === true };
}
