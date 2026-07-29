export type HeroRingData = {
  totalHours: string;
  flights: number;
  terrains: number;
  countries: number;
};

export type PilotStatusData = {
  licence: string;
  medical: string;
  nextCheck: string;
};

export type ConditionsData = {
  meanWind: string;
  gusts: string;
  sunrise: string;
  modelName: string;
  modelTime: string;
};

export type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type LastFlightData = {
  date: string;
  duration: string;
  distance: string;
  departure: string;
  arrival: string;
  route: RoutePoint[];
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
