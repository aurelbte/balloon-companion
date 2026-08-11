import { createBalloon, REGISTERED_BALLOONS, updateBalloon, type Balloon, type BalloonInput } from "./balloons.ts";
import { getRuntimeDataScope, readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
export const BALLOON_REGISTRY_VERSION = 5;
const STORAGE_KEY = "balloon-companion-balloons";
export const BALLOON_REGISTRY_EVENT = "balloon-companion:balloons-changed";
export const NEW_BALLOON_SELECTION_KEY = "balloon-companion-new-balloon-selection";
export const NEW_BALLOON_RETURN_KEY = "balloon-companion-balloon-return";
export type BalloonRegistry = { version: typeof BALLOON_REGISTRY_VERSION; balloons: readonly Balloon[]; activeBalloonId: string | null };

export function createDefaultBalloonRegistry(): BalloonRegistry { return { version: BALLOON_REGISTRY_VERSION, balloons: REGISTERED_BALLOONS, activeBalloonId: "F-HLFM" }; }
export function getActiveBalloon(registry: BalloonRegistry): Balloon | null { return registry.balloons.find(({ id }) => id === registry.activeBalloonId) ?? null; }
function numberOrUndefined(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function migrateBalloon(value: unknown, allowStoredConfirmation: boolean): Balloon | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Balloon> & { weights?: Record<string, unknown>; envelopeWeightKg?: unknown; burnerWeightKg?: unknown; basketWeightKg?: unknown; cylinders?: unknown };
  if (typeof item.id !== "string" || typeof item.registration !== "string" || typeof item.manufacturer !== "string" || typeof item.model !== "string") return null;
  const reference = REGISTERED_BALLOONS.find(({ registration }) => registration === item.registration);
  const legacyWeights: Record<string, unknown> = item.weights && typeof item.weights === "object" ? item.weights : {};
  const cylinderSource = Array.isArray(legacyWeights.fullCylinders) ? legacyWeights.fullCylinders : Array.isArray(legacyWeights.cylinders) ? legacyWeights.cylinders : Array.isArray(item.cylinders) ? item.cylinders : [];
  const cylinders = cylinderSource
    .filter((cylinder: unknown): cylinder is { id: string; label?: string; fullWeightKg: number } => Boolean(
      cylinder
      && typeof cylinder === "object"
      && typeof (cylinder as { id?: unknown }).id === "string"
      && typeof (cylinder as { fullWeightKg?: unknown }).fullWeightKg === "number"
      && (cylinder as { fullWeightKg: number }).fullWeightKg > 0,
    ));
  const envelopeKg = numberOrUndefined(legacyWeights.envelopeKg) ?? numberOrUndefined(legacyWeights.envelopeWeightKg) ?? numberOrUndefined(item.envelopeWeightKg);
  const burnerKg = numberOrUndefined(legacyWeights.burnerKg) ?? numberOrUndefined(legacyWeights.burnerWeightKg) ?? numberOrUndefined(item.burnerWeightKg);
  const basketKg = numberOrUndefined(legacyWeights.basketKg) ?? numberOrUndefined(legacyWeights.basketWeightKg) ?? numberOrUndefined(item.basketWeightKg);
  const legacyWeightRecovery = Object.fromEntries(Object.entries({ envelopeWeightKg: legacyWeights.envelopeWeightKg ?? item.envelopeWeightKg, burnerWeightKg: legacyWeights.burnerWeightKg ?? item.burnerWeightKg, basketWeightKg: legacyWeights.basketWeightKg ?? item.basketWeightKg, cylinders: legacyWeights.cylinders ?? item.cylinders }).filter(([, entry]) => entry !== undefined));
  return {
    id: item.id,
    registration: item.registration,
    manufacturer: item.manufacturer,
    model: item.model,
    category: item.category === "Libre à gaz" ? "Libre à gaz" : "Libre à air chaud",
    volumeM3: numberOrUndefined(item.volumeM3) ?? reference?.volumeM3 ?? 0,
    ...(numberOrUndefined(item.applicableMtowKg) === undefined ? {} : { applicableMtowKg: numberOrUndefined(item.applicableMtowKg) }),
    configurationLimitsConfirmed: allowStoredConfirmation && item.configurationLimitsConfirmed === true,
    ...(typeof item.color === "string" && item.color ? { color: item.color } : {}),
    ...(item.isFavorite ? { isFavorite: true } : {}),
    documents: Array.isArray(item.documents) ? item.documents : [],
    ...(Object.keys(legacyWeightRecovery).length > 0 ? { legacyWeightRecovery } : {}),
    weights: {
      ...(envelopeKg === undefined ? {} : { envelopeKg }),
      ...(burnerKg === undefined ? {} : { burnerKg }),
      ...(basketKg === undefined ? {} : { basketKg }),
      fullCylinders: cylinders,
    },
  };
}
export function migrateBalloonRegistry(value: unknown): BalloonRegistry { if (!value || typeof value !== "object") return createDefaultBalloonRegistry(); const stored = value as { version?: unknown; balloons?: unknown; activeBalloonId?: unknown }; if (!Array.isArray(stored.balloons)) return createDefaultBalloonRegistry(); const currentVersion = stored.version === BALLOON_REGISTRY_VERSION; const balloons = stored.balloons.map((item) => migrateBalloon(item, currentVersion)).filter((item): item is Balloon => item !== null); const storedActive = typeof stored.activeBalloonId === "string" && balloons.some(({ id }) => id === stored.activeBalloonId) ? stored.activeBalloonId : null; if (currentVersion) return { version: BALLOON_REGISTRY_VERSION, balloons, activeBalloonId: storedActive }; const legacyActive = storedActive ?? balloons.find(({ isFavorite }) => isFavorite)?.id ?? null; return { version: BALLOON_REGISTRY_VERSION, balloons, activeBalloonId: legacyActive }; }
export function addBalloonToRegistry(registry: BalloonRegistry, input: BalloonInput): { registry: BalloonRegistry; balloon: Balloon } { const balloon = createBalloon(input); const balloons = [...registry.balloons.filter(({ registration }) => registration !== balloon.registration), balloon]; return { balloon, registry: { ...registry, balloons, activeBalloonId: registry.activeBalloonId ?? balloon.id } }; }
export function updateBalloonInRegistry(registry: BalloonRegistry, id: string, input: BalloonInput): BalloonRegistry { const current = registry.balloons.find((item) => item.id === id); if (!current) return registry; return { ...registry, balloons: registry.balloons.map((item) => item.id === id ? updateBalloon(current, input) : item) }; }
export function removeBalloonFromRegistry(registry: BalloonRegistry, id: string): BalloonRegistry { if (!registry.balloons.some((item) => item.id === id)) return registry; return { ...registry, balloons: registry.balloons.filter((item) => item.id !== id), activeBalloonId: registry.activeBalloonId === id ? null : registry.activeBalloonId }; }
export function setActiveBalloonInRegistry(registry: BalloonRegistry, id: string): BalloonRegistry { return registry.balloons.some((item) => item.id === id) ? { ...registry, activeBalloonId: id } : registry; }
export function loadBalloonRegistry(): BalloonRegistry { if (typeof window === "undefined") return createDefaultBalloonRegistry(); const scope = getRuntimeDataScope(); const empty = { version: BALLOON_REGISTRY_VERSION, balloons: [], activeBalloonId: null } satisfies BalloonRegistry; if (!scope) return empty; try { const parsed: unknown = JSON.parse(readScopedBusinessValue(window.localStorage, STORAGE_KEY) ?? "null"); if (scope !== "GUEST" && !parsed) return empty; const registry = migrateBalloonRegistry(parsed); if (scope === "GUEST" && (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== BALLOON_REGISTRY_VERSION)) writeScopedBusinessValue(window.localStorage, STORAGE_KEY, JSON.stringify(registry)); return registry; } catch { return scope === "GUEST" ? createDefaultBalloonRegistry() : empty; } }
export function saveBalloonRegistry(registry: BalloonRegistry): void { if (typeof window === "undefined") return; if (writeScopedBusinessValue(window.localStorage, STORAGE_KEY, JSON.stringify(registry))) window.dispatchEvent(new Event(BALLOON_REGISTRY_EVENT)); }
export function loadBalloons(): Balloon[] { return [...loadBalloonRegistry().balloons]; }
export function addBalloon(input: BalloonInput): Balloon { const result = addBalloonToRegistry(loadBalloonRegistry(), input); saveBalloonRegistry(result.registry); return result.balloon; }
export function editBalloon(id: string, input: BalloonInput): void { saveBalloonRegistry(updateBalloonInRegistry(loadBalloonRegistry(), id, input)); }
export function deleteBalloon(id: string): void { saveBalloonRegistry(removeBalloonFromRegistry(loadBalloonRegistry(), id)); }
export function setActiveBalloon(id: string): void { saveBalloonRegistry(setActiveBalloonInRegistry(loadBalloonRegistry(), id)); }
