import type { JournalFlight } from "./journalMockData.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { formatFlightAltitude, formatFlightDistance, formatFlightSpeed, type UnitPreferences } from "./unitPreferences.ts";
import type { Balloon } from "./balloons.ts";

export type PassengerMemoryBalloon = Readonly<Pick<Balloon, "id" | "manufacturer" | "model" | "registration">>;

export type PassengerMemoryModel = Readonly<{
  date: string;
  departure: string;
  arrival: string;
  displayedDuration: string;
  distance: string;
  maximumAltitude: string;
  maximumSpeed: string;
  pilotName: string | null;
  balloon: Readonly<{ id: string; label: string }> | null;
}>;

export function passengerMemoryBalloonLabel(balloon: PassengerMemoryBalloon): string | null {
  const name = [balloon.manufacturer.trim(), balloon.model.trim()].filter(Boolean).join(" ");
  const registration = balloon.registration.trim();
  return [name, registration].filter(Boolean).join(" · ") || null;
}

export function defaultPassengerMemoryBalloonId(balloons: readonly PassengerMemoryBalloon[], activeBalloonId: string | null): string {
  if (balloons.length === 1) return balloons[0].id;
  return balloons.some(({ id }) => id === activeBalloonId) ? activeBalloonId ?? "" : "";
}

export function formatPassengerMemoryDuration(durationSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(Number.isFinite(durationSeconds) ? durationSeconds / 60 : 0));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, "0")}`;
}

function pilotName(firstName: string | undefined, lastName: string | undefined): string | null {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ") || null;
}

export function buildPassengerMemoryModel(input: Readonly<{
  recordedFlight: RecordedFlight;
  journalFlight: JournalFlight;
  units: UnitPreferences["flightInstruments"];
  displayedDuration?: string;
  pilot?: Readonly<{ firstName?: string; lastName?: string }> | null;
  selectedBalloon?: PassengerMemoryBalloon | null;
}>): PassengerMemoryModel {
  const { recordedFlight, journalFlight, units } = input;
  return {
    date: journalFlight.date,
    departure: journalFlight.departure.trim() || "Départ non renseigné",
    arrival: journalFlight.arrival.trim() || "Arrivée non renseignée",
    displayedDuration: input.displayedDuration?.trim() || formatPassengerMemoryDuration(recordedFlight.summary.durationSeconds),
    distance: formatFlightDistance(recordedFlight.summary.distanceMeters / 1000, units.distanceUnit),
    maximumAltitude: recordedFlight.summary.maxAltitudeMeters === null ? "Non disponible" : formatFlightAltitude(recordedFlight.summary.maxAltitudeMeters, units.altitudeUnit),
    maximumSpeed: recordedFlight.summary.maxGroundSpeedMetersPerSecond === null ? "Non disponible" : formatFlightSpeed(recordedFlight.summary.maxGroundSpeedMetersPerSecond * 3.6, units.speedUnit),
    pilotName: pilotName(input.pilot?.firstName, input.pilot?.lastName),
    balloon: input.selectedBalloon && passengerMemoryBalloonLabel(input.selectedBalloon)
      ? { id: input.selectedBalloon.id, label: passengerMemoryBalloonLabel(input.selectedBalloon)! }
      : null,
  };
}

function slug(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function passengerMemoryFilename(recordedFlight: RecordedFlight, journalFlight: JournalFlight): string {
  const date = new Date(recordedFlight.startedAt);
  const datePart = Number.isFinite(date.getTime()) ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-") : "vol";
  const route = [slug(journalFlight.departure), slug(journalFlight.arrival)].filter(Boolean).join("-");
  return `balloon-companion-souvenir${route ? `-${route}` : ""}-${datePart}.pdf`;
}
