import type { JournalFlight } from "./journalMockData.ts";
import type { RecordedFlight } from "./recordedFlight.ts";
import { formatFlightDistance, formatFlightSpeed, getFlightAltitudeReadings, type UnitPreferences } from "./unitPreferences.ts";
import { normalizeBalloonRegistration, type Balloon } from "./balloons.ts";

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
  balloon: Readonly<{ id: string; name: string | null; registration: string | null; label: string }> | null;
}>;

export function passengerMemoryBalloonLabel(balloon: PassengerMemoryBalloon): string | null {
  const name = [balloon.manufacturer.trim(), balloon.model.trim()].filter(Boolean).join(" ");
  const registration = balloon.registration.trim();
  return [name, registration].filter(Boolean).join(" · ") || null;
}

export function defaultPassengerMemoryBalloonId(balloons: readonly PassengerMemoryBalloon[], recordedFlightRegistration: string | undefined, activeBalloonId: string | null): string {
  const normalizedFlightRegistration = recordedFlightRegistration ? normalizeBalloonRegistration(recordedFlightRegistration) : "";
  const flightBalloon = normalizedFlightRegistration
    ? balloons.find(({ registration }) => normalizeBalloonRegistration(registration) === normalizedFlightRegistration)
    : undefined;
  if (flightBalloon) return flightBalloon.id;
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
  const first = firstName?.trim();
  const last = lastName?.trim();
  return first && last ? `${first} ${last}` : null;
}

function dualPassengerMemoryAltitude(valueMetres: number | null): string {
  const readings = getFlightAltitudeReadings(valueMetres, "m");
  if (!readings) return "Non disponible";
  const clean = (value: string) => value.replace(/\s/g, " ");
  return `${clean(readings.primary.value)} ${readings.primary.unit} · ${clean(readings.secondary.value)} ${readings.secondary.unit}`;
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
    maximumAltitude: dualPassengerMemoryAltitude(recordedFlight.summary.maxAltitudeMeters),
    maximumSpeed: recordedFlight.summary.maxGroundSpeedMetersPerSecond === null ? "Non disponible" : formatFlightSpeed(recordedFlight.summary.maxGroundSpeedMetersPerSecond * 3.6, units.speedUnit),
    pilotName: pilotName(input.pilot?.firstName, input.pilot?.lastName),
    balloon: input.selectedBalloon && passengerMemoryBalloonLabel(input.selectedBalloon) ? {
      id: input.selectedBalloon.id,
      name: [input.selectedBalloon.manufacturer.trim(), input.selectedBalloon.model.trim()].filter(Boolean).join(" ") || null,
      registration: input.selectedBalloon.registration.trim() || null,
      label: passengerMemoryBalloonLabel(input.selectedBalloon)!,
    } : null,
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
