import type { RecordedFlight } from "./recordedFlight.ts";
import { UNKNOWN_ARRIVAL, UNKNOWN_DEPARTURE } from "./journalFlightTitle.ts";

type ReverseGeocodingResponse = {
  startLocationLabel?: unknown;
  endLocationLabel?: unknown;
};

function usableLabel(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() && value !== "Lieu inconnu"
    ? value.trim()
    : fallback;
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
  timeoutMs = 3_000,
): Promise<RecordedFlight> {
  const start = flight.points[0];
  const end = flight.points.at(-1);
  const fallback = withRecordedFlightLocationFallbacks(flight, preparedStartName);
  if (!start || !end) return fallback;
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
          start: { latitude: start.latitude, longitude: start.longitude },
          end: { latitude: end.latitude, longitude: end.longitude },
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
  const startLocationLabel = usableLabel(payload.startLocationLabel, fallback.startLocationLabel!);
  const endLocationLabel = usableLabel(payload.endLocationLabel, fallback.endLocationLabel!);
  return {
    ...flight,
    startLocationLabel,
    endLocationLabel,
    generatedTitle: `${startLocationLabel} → ${endLocationLabel}`,
  };
}
