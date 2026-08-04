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

export async function resolveRecordedFlightLocations(
  flight: RecordedFlight,
  preparedStartName?: string,
  request: typeof fetch = fetch,
): Promise<RecordedFlight> {
  const start = flight.points[0];
  const end = flight.points.at(-1);
  const fallbackStart = preparedStartName?.trim() || UNKNOWN_DEPARTURE;
  if (!start || !end) {
    return {
      ...flight,
      startLocationLabel: fallbackStart,
      endLocationLabel: UNKNOWN_ARRIVAL,
      generatedTitle: `${fallbackStart} → ${UNKNOWN_ARRIVAL}`,
    };
  }

  let payload: ReverseGeocodingResponse = {};
  try {
    const response = await request("/api/geocoding/reverse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        start: { latitude: start.latitude, longitude: start.longitude },
        end: { latitude: end.latitude, longitude: end.longitude },
        preparedStartName,
      }),
    });
    if (response.ok) payload = await response.json() as ReverseGeocodingResponse;
  } catch {
    // La géolocalisation ne doit jamais empêcher la conservation du vol.
  }
  const startLocationLabel = usableLabel(payload.startLocationLabel, fallbackStart);
  const endLocationLabel = usableLabel(payload.endLocationLabel, UNKNOWN_ARRIVAL);
  return {
    ...flight,
    startLocationLabel,
    endLocationLabel,
    generatedTitle: `${startLocationLabel} → ${endLocationLabel}`,
  };
}
