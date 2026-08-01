export type BalloonDocument = { id: string; type: "insurance" | "cdn" | "cen" | "maintenance" | "registration" | "other"; label: string; expirationDate?: string; status: "valid" | "expiring" | "expired" | "missing" };
export type BalloonWeights = { envelopeKg?: number; basketKg?: number; burnerKg?: number; cylinderKg?: number; cylinderCount?: number; equipmentKg?: number; emptyOperatingWeightKg?: number };
export type Balloon = { id: string; registration: string; manufacturer: string; model: string; volumeM3?: number; color?: string; isFavorite?: boolean; lastUsedAt?: string; documents: BalloonDocument[]; weights: BalloonWeights };
export type NewBalloonInput = Pick<Balloon, "registration" | "manufacturer" | "model" | "volumeM3" | "color">;

export const REGISTERED_BALLOONS: readonly Balloon[] = [
  { id: "F-HLFM", registration: "F-HLFM", manufacturer: "Cameron", model: "Z105", isFavorite: true, documents: [], weights: {} },
  { id: "F-HOBA", registration: "F-HOBA", manufacturer: "Cameron", model: "Z350", documents: [], weights: {} },
  { id: "F-HMIG", registration: "F-HMIG", manufacturer: "Cameron", model: "Z350", documents: [], weights: {} },
  { id: "F-GTET", registration: "F-GTET", manufacturer: "Cameron", model: "Z150", documents: [], weights: {} },
] as const;

export function balloonDisplayName(balloon: Pick<Balloon, "registration" | "manufacturer" | "model">): string {
  return `${balloon.registration} • ${balloon.manufacturer} ${balloon.model}`;
}

export function createBalloon(input: NewBalloonInput): Balloon {
  const registration = input.registration.trim().toUpperCase();
  return { id: registration, registration, manufacturer: input.manufacturer.trim(), model: input.model.trim(), ...(input.volumeM3 === undefined ? {} : { volumeM3: input.volumeM3 }), ...(input.color?.trim() ? { color: input.color.trim() } : {}), documents: [], weights: {} };
}

export function officialFieldsForBalloon(balloon: Pick<Balloon, "registration" | "manufacturer" | "model">): { registration: string; balloonModel: string } {
  return { registration: balloon.registration, balloonModel: `${balloon.manufacturer} ${balloon.model}` };
}
