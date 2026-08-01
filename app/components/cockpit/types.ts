export type HeroRingData = {
  totalHours: number;
  displayHours: string;
  flights: number | "—";
};

export type PilotCredentialStatus = {
  label: string;
  dueDate: string | null;
  remainingMonths: number | null;
};

export type PilotStatusData = {
  flightTest: PilotCredentialStatus | null;
  medical: PilotCredentialStatus | null;
};

export type ConditionsData = {
  windDirectionDeg: number;
  wind: string;
  gusts: string;
  temperature: string;
  sunrise: string;
  sunset: string;
};

export type LastFlightData = {
  date: string;
  duration: string;
  departure: string;
  arrival: string;
};

/** Retained for potential journal summaries; no longer rendered in Cockpit. */
export type WeeklyActivityData = {
  flights: string;
  hours: string;
  cumulativeTime: string;
};

export type { Balloon, BalloonDocument, BalloonWeights } from "../../lib/balloons";
