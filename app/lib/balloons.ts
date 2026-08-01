export type BalloonCategory = "Libre à air chaud" | "Libre à gaz";
export type BalloonDocument = { id: string; type: "insurance" | "cdn" | "cen" | "maintenance" | "registration" | "other"; label: string; expirationDate?: string; status: "valid" | "expiring" | "expired" | "missing" };
export type FullCylinder = { id: string; label?: string; fullWeightKg: number };
export type BalloonWeights = { envelopeKg?: number; basketKg?: number; burnerKg?: number; fullCylinders: readonly FullCylinder[] };
export type Balloon = {
  id: string;
  registration: string;
  manufacturer: string;
  model: string;
  category: BalloonCategory;
  volumeM3: number;
  /** MTOM applicable à cette configuration précise, confirmée par le pilote. */
  applicableMtowKg?: number;
  color?: string;
  isFavorite?: boolean;
  lastUsedAt?: string;
  documents: BalloonDocument[];
  weights: BalloonWeights;
};
export type BalloonInput = Omit<Balloon, "id" | "documents" | "isFavorite" | "lastUsedAt">;
export type BalloonSnapshot = Pick<Balloon, "registration" | "manufacturer" | "model" | "category">;

export const REGISTERED_BALLOONS: readonly Balloon[] = [
  { id: "F-HLFM", registration: "F-HLFM", manufacturer: "Cameron", model: "Z105", category: "Libre à air chaud", volumeM3: 2_973, applicableMtowKg: 952, isFavorite: true, documents: [], weights: { fullCylinders: [] } },
  { id: "F-HOBA", registration: "F-HOBA", manufacturer: "Cameron", model: "Z350", category: "Libre à air chaud", volumeM3: 9_911, documents: [], weights: { fullCylinders: [] } },
  { id: "F-HMIG", registration: "F-HMIG", manufacturer: "Cameron", model: "Z350", category: "Libre à air chaud", volumeM3: 9_911, documents: [], weights: { fullCylinders: [] } },
  { id: "F-GTET", registration: "F-GTET", manufacturer: "Cameron", model: "Z150", category: "Libre à air chaud", volumeM3: 4_247, documents: [], weights: { fullCylinders: [] } },
] as const;

export function normalizeBalloonRegistration(value: string): string { const normalized = value.trim().replace(/\s+/g, "").toUpperCase(); return /^F[A-Z0-9]{4}$/.test(normalized) ? `F-${normalized.slice(1)}` : normalized; }
export function balloonDisplayName(balloon: Pick<Balloon, "registration" | "manufacturer" | "model">): string { return `${balloon.registration} • ${balloon.manufacturer} ${balloon.model}`; }
export function createBalloon(input: BalloonInput, id = normalizeBalloonRegistration(input.registration)): Balloon {
  return { id, registration: normalizeBalloonRegistration(input.registration), manufacturer: input.manufacturer.trim(), model: input.model.trim(), category: input.category, volumeM3: input.volumeM3, ...(input.applicableMtowKg === undefined ? {} : { applicableMtowKg: input.applicableMtowKg }), ...(input.color?.trim() ? { color: input.color.trim() } : {}), documents: [], weights: { ...input.weights, fullCylinders: input.weights.fullCylinders.map((cylinder) => ({ ...cylinder, ...(cylinder.label?.trim() ? { label: cylinder.label.trim() } : {}) })) } };
}
export function updateBalloon(current: Balloon, input: BalloonInput): Balloon { return { ...createBalloon(input, current.id), documents: current.documents, ...(current.isFavorite ? { isFavorite: true } : {}), ...(current.lastUsedAt ? { lastUsedAt: current.lastUsedAt } : {}) }; }
export function balloonSnapshot(balloon: Balloon): BalloonSnapshot { return { registration: balloon.registration, manufacturer: balloon.manufacturer, model: balloon.model, category: balloon.category }; }
export function calculateBalloonWeight(weights: BalloonWeights): number | null { if (!(weights.envelopeKg && weights.envelopeKg > 0) || !(weights.burnerKg && weights.burnerKg > 0) || !(weights.basketKg && weights.basketKg > 0) || weights.fullCylinders.some(({ fullWeightKg }) => !(fullWeightKg > 0))) return null; return weights.envelopeKg + weights.burnerKg + weights.basketKg + weights.fullCylinders.reduce((total, cylinder) => total + cylinder.fullWeightKg, 0); }
export function calculateBalloonEmptyWeight(balloon: Balloon): number | null { return calculateBalloonWeight(balloon.weights); }
export function officialFieldsForBalloon(balloon: Balloon): { registration: string; balloonModel: string; balloonManufacturer: string; category: BalloonCategory } { return { registration: balloon.registration, balloonModel: `${balloon.manufacturer} ${balloon.model}`, balloonManufacturer: balloon.manufacturer, category: balloon.category }; }
export function resolveBalloonForFlight(balloons: readonly Balloon[], selectedBalloonId: string | undefined, activeBalloonId: string | null): Balloon | null { return balloons.find(({ id }) => id === selectedBalloonId) ?? balloons.find(({ id }) => id === activeBalloonId) ?? null; }
