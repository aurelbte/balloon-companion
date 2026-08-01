export type BalloonCategory = "Libre à air chaud" | "Libre à gaz";
export type BalloonDocument = { id: string; type: "insurance" | "cdn" | "cen" | "maintenance" | "registration" | "other"; label: string; expirationDate?: string; status: "valid" | "expiring" | "expired" | "missing" };
export type BalloonWeights = { envelopeKg?: number; basketKg?: number; burnerKg?: number; cylinderKg?: number; cylinderCount?: number; equipmentKg?: number; emptyOperatingWeightKg?: number };
export type Balloon = {
  id: string;
  registration: string;
  manufacturer: string;
  model: string;
  category: BalloonCategory;
  volumeM3: number;
  emptyWeightKg?: number;
  maximumAuthorizedWeightKg?: number;
  maximumOccupants?: number;
  cylinderCount?: number;
  totalFuelCapacity?: number;
  color?: string;
  isFavorite?: boolean;
  lastUsedAt?: string;
  documents: BalloonDocument[];
  weights: BalloonWeights;
};
export type BalloonInput = Omit<Balloon, "id" | "documents" | "weights" | "isFavorite" | "lastUsedAt">;
export type BalloonSnapshot = Pick<Balloon, "registration" | "manufacturer" | "model" | "category">;

export const REGISTERED_BALLOONS: readonly Balloon[] = [
  { id: "F-HLFM", registration: "F-HLFM", manufacturer: "Cameron", model: "Z105", category: "Libre à air chaud", volumeM3: 2_973, isFavorite: true, documents: [], weights: {} },
  { id: "F-HOBA", registration: "F-HOBA", manufacturer: "Cameron", model: "Z350", category: "Libre à air chaud", volumeM3: 9_911, documents: [], weights: {} },
  { id: "F-HMIG", registration: "F-HMIG", manufacturer: "Cameron", model: "Z350", category: "Libre à air chaud", volumeM3: 9_911, documents: [], weights: {} },
  { id: "F-GTET", registration: "F-GTET", manufacturer: "Cameron", model: "Z150", category: "Libre à air chaud", volumeM3: 4_247, documents: [], weights: {} },
] as const;

export function normalizeBalloonRegistration(value: string): string { return value.trim().replace(/\s+/g, "").toUpperCase(); }
export function balloonDisplayName(balloon: Pick<Balloon, "registration" | "manufacturer" | "model">): string { return `${balloon.registration} • ${balloon.manufacturer} ${balloon.model}`; }
export function createBalloon(input: BalloonInput, id = normalizeBalloonRegistration(input.registration)): Balloon {
  return { id, registration: normalizeBalloonRegistration(input.registration), manufacturer: input.manufacturer.trim(), model: input.model.trim(), category: input.category, volumeM3: input.volumeM3, ...(input.emptyWeightKg === undefined ? {} : { emptyWeightKg: input.emptyWeightKg }), ...(input.maximumAuthorizedWeightKg === undefined ? {} : { maximumAuthorizedWeightKg: input.maximumAuthorizedWeightKg }), ...(input.maximumOccupants === undefined ? {} : { maximumOccupants: input.maximumOccupants }), ...(input.cylinderCount === undefined ? {} : { cylinderCount: input.cylinderCount }), ...(input.totalFuelCapacity === undefined ? {} : { totalFuelCapacity: input.totalFuelCapacity }), ...(input.color?.trim() ? { color: input.color.trim() } : {}), documents: [], weights: {} };
}
export function updateBalloon(current: Balloon, input: BalloonInput): Balloon { return { ...createBalloon(input, current.id), documents: current.documents, weights: current.weights, ...(current.isFavorite ? { isFavorite: true } : {}), ...(current.lastUsedAt ? { lastUsedAt: current.lastUsedAt } : {}) }; }
export function balloonSnapshot(balloon: Balloon): BalloonSnapshot { return { registration: balloon.registration, manufacturer: balloon.manufacturer, model: balloon.model, category: balloon.category }; }
export function theoreticalCapacityKg(balloon: Balloon): number | null { return balloon.maximumAuthorizedWeightKg === undefined || balloon.emptyWeightKg === undefined ? null : balloon.maximumAuthorizedWeightKg - balloon.emptyWeightKg; }
export function officialFieldsForBalloon(balloon: Balloon): { registration: string; balloonModel: string; balloonManufacturer: string; category: BalloonCategory } { return { registration: balloon.registration, balloonModel: `${balloon.manufacturer} ${balloon.model}`, balloonManufacturer: balloon.manufacturer, category: balloon.category }; }
export function resolveBalloonForFlight(balloons: readonly Balloon[], selectedBalloonId: string | undefined, activeBalloonId: string | null): Balloon | null { return balloons.find(({ id }) => id === selectedBalloonId) ?? balloons.find(({ id }) => id === activeBalloonId) ?? null; }
