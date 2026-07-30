export type HeroRingData = {
  totalHours: number;
  displayHours: string;
  flights: number;
};

export type PilotCredentialStatus = {
  label: string;
  dueDate: string;
  remainingMonths: number;
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

export type BalloonDocument = {
  id: string;
  type:
    | "insurance"
    | "cdn"
    | "cen"
    | "maintenance"
    | "registration"
    | "other";
  label: string;
  expirationDate?: string;
  status: "valid" | "expiring" | "expired" | "missing";
};

export type BalloonWeights = {
  envelopeKg?: number;
  basketKg?: number;
  burnerKg?: number;
  cylinderKg?: number;
  cylinderCount?: number;
  equipmentKg?: number;
  emptyOperatingWeightKg?: number;
};

export type Balloon = {
  id: string;
  registration: string;
  manufacturer: string;
  model: string;
  volumeM3?: number;
  isFavorite?: boolean;
  lastUsedAt?: string;
  documents: BalloonDocument[];
  weights: BalloonWeights;
};
