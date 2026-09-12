import { FLIGHT_LOCATIONS_TIMEOUT_MS } from "./reverseGeocoding.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { UNKNOWN_ARRIVAL, UNKNOWN_DEPARTURE } from "./journalFlightTitle.ts";

type ReverseGeocodingResponse = {
  startLocationLabel?: unknown;
  endLocationLabel?: unknown;
};

export function isUnknownFlightLocation(value: unknown): boolean {
  return typeof value !== "string" || !value.trim() ||
    ["Lieu inconnu", UNKNOWN_DEPARTURE, UNKNOWN_ARRIVAL].includes(value.trim());
}

function usableLabel(value: unknown, fallback: string): string {
  return isUnknownFlightLocation(value) ? fallback : (value as string).trim();
}

export function withRecordedFlightLocationFallbacks(flight: RecordedFlight, preparedStartName?: string): RecordedFlight {
  const startLocationLabel = usableLabel(flight.startLocationLabel, preparedStartName?.trim() || UNKNOWN_DEPARTURE);
  const endLocationLabel = usableLabel(flight.endLocationLabel, UNKNOWN_ARRIVAL);
  return { ...flight, startLocationLabel, endLocationLabel, generatedTitle: `${startLocationLabel} → ${endLocationLabel}` };
}

export async function resolveRecordedFlightLocations(
  flight: RecordedFlight,
  preparedStartName?: string,
  request: typeof fetch = fetch,
  timeoutMs = FLIGHT_LOCATIONS_TIMEOUT_MS,
): Promise<RecordedFlight> {
  const start = flight.points[0];
  const end = flight.points.at(-1);
  const fallback = withRecordedFlightLocationFallbacks(flight, preparedStartName);
  const needsStart = isUnknownFlightLocation(fallback.startLocationLabel);
  const needsEnd = isUnknownFlightLocation(fallback.endLocationLabel);
  if ((!needsStart && !needsEnd) || !start || !end) return fallback;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let payload: ReverseGeocodingResponse = {};
  try {
    const resolution = async (): Promise<ReverseGeocodingResponse> => {
      const response = await request("/api/geocoding/reverse", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(needsStart ? { start: { latitude: start.latitude, longitude: start.longitude } } : {}),
          ...(needsEnd ? { end: { latitude: end.latitude, longitude: end.longitude } } : {}),
          preparedStartName,
        }),
      });
      return response.ok ? await response.json() as ReverseGeocodingResponse : {};
    };
    payload = await Promise.race([
      resolution(),
      new Promise<ReverseGeocodingResponse>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve({}); }, timeoutMs);
      }),
    ]);
  } catch {
    // Network enrichment is optional, including response body failures.
  } finally {
    clearTimeout(timer);
  }
  const startLocationLabel = needsStart ? usableLabel(payload.startLocationLabel, fallback.startLocationLabel!) : fallback.startLocationLabel!;
  const endLocationLabel = needsEnd ? usableLabel(payload.endLocationLabel, fallback.endLocationLabel!) : fallback.endLocationLabel!;
  return {
    ...flight,
    startLocationLabel,
    endLocationLabel,
    generatedTitle: `${startLocationLabel} → ${endLocationLabel}`,
  };
}
