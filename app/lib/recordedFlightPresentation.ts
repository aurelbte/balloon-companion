import type { RecordedFlight } from "./recordedFlight.ts";
import { DEFAULT_UNIT_PREFERENCES, formatFlightAltitude, formatFlightDistance, formatFlightSpeed, type UnitPreferences } from "./unitPreferences.ts";

export interface RecordedFlightPresentation {
  date: string;
  startTime: string;
  endTime: string;
  duration: string;
  distance: string;
  minAltitude: string;
  maxAltitude: string;
  averageGroundSpeed: string;
  maxGroundSpeed: string;
  pointCount: string;
}

export function getFlightReplayPath(flightId: string): string {
  return `/flights/${encodeURIComponent(flightId)}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function getRecordedFlightPresentation(
  flight: RecordedFlight,
  locale = "fr-FR",
  units: UnitPreferences["flightInstruments"] = DEFAULT_UNIT_PREFERENCES.flightInstruments,
): RecordedFlightPresentation {
  const start = new Date(flight.startedAt);
  const end = flight.endedAt === null ? null : new Date(flight.endedAt);
  const altitude = (value: number | null) =>
    value === null || !Number.isFinite(value)
      ? "—"
      : formatFlightAltitude(value, units.altitudeUnit);
  const speed = (value: number | null) =>
    value === null || !Number.isFinite(value)
      ? "—"
      : formatFlightSpeed(value * 3.6, units.speedUnit, 1);

  return {
    date: start.toLocaleDateString(locale),
    startTime: start.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }),
    endTime:
      end?.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }) ?? "—",
    duration: formatDuration(flight.summary.durationSeconds),
    distance: formatFlightDistance(flight.summary.distanceMeters / 1000, units.distanceUnit, 2),
    minAltitude: altitude(flight.summary.minAltitudeMeters),
    maxAltitude: altitude(flight.summary.maxAltitudeMeters),
    averageGroundSpeed: speed(
      flight.summary.averageGroundSpeedMetersPerSecond,
    ),
    maxGroundSpeed: speed(flight.summary.maxGroundSpeedMetersPerSecond),
    pointCount: String(flight.points.length),
  };
}
