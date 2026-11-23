import { prepareMoroccoPassengers, type MoroccoDossierPdfInput, type MoroccoPassenger } from "./moroccoPassengers.ts";
import { prepareDossierLoad } from "./flightDossierOperations.ts";
import { balloonEquipmentWeightForLoad } from "./loadPerformance/balloonInput.ts";
import { moroccoLandingMassConfigurationKey, moroccoMinimumLandingMass } from "./moroccoMinimumLandingMass.ts";
import type { Balloon } from "./balloons.ts";
import type { MoroccoLandingMassApplicability } from "./moroccoMinimumLandingMass.ts";

export type MoroccoDossierLoading = { pilotKg: number; equipmentKg: number; passengerCount: number; expectedGasConsumptionKg?: number;
  fuel?: { propaneOnBoardKg: number; fullCylinderMassesConfirmed: boolean; configurationKey: string } };
export const MOROCCO_LOADING_DEFAULTS = Object.freeze({ pilotKg: 60, equipmentKg: 5 });
export function moroccoDefaultGasConsumption(balloon: Balloon): number | undefined {
  return balloon.registration.replace(/[ -]/g, "").toUpperCase() === "CNCBN" && balloon.manufacturer.trim().toLowerCase() === "cameron" &&
    balloon.model.replace(/[ -]/g, "").toUpperCase() === "Z275" ? 70 : undefined;
}
/** The current preparation stores metres AMSL. AGL is accepted only with an explicit terrain datum. */
export function moroccoProjectedAltitudeAmsl(raw: string, reference: "AMSL" | "AGL", terrainAmslM?: number): number {
  if (reference !== "AMSL" && reference !== "AGL") throw new Error("Référentiel d’altitude inconnu : aucune conversion possible.");
  const value = parseMoroccoMass(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error("Altitude projetée absente ou invalide (m).");
  if (reference === "AGL" && !Number.isFinite(terrainAmslM)) throw new Error("Conversion AGL/AMSL impossible : altitude du terrain absente.");
  const amsl = value + (reference === "AGL" ? terrainAmslM! : 0);
  if (!Number.isFinite(amsl)) throw new Error("Altitude projetée invalide.");
  if (Number.isFinite(terrainAmslM) && amsl < terrainAmslM!) throw new Error("Altitude projetée sous le terrain.");
  return amsl;
}
export function parseMoroccoMass(raw: string): number {
  const text = raw.trim().replace(",", ".");
  return /^\d+(?:\.\d*)?$/.test(text) ? Number(text) : NaN;
}
export function calculateMoroccoLoading(passengers: readonly MoroccoPassenger[], loading: MoroccoDossierLoading) {
  const rows = prepareMoroccoPassengers(passengers), active = rows.filter(row => row.sex !== "");
  if (!Number.isInteger(loading.passengerCount) || loading.passengerCount !== active.length) throw new Error("Le nombre de passagers ne correspond pas au listing.");
  if (!Number.isFinite(loading.pilotKg) || loading.pilotKg <= 0) throw new Error("Pilote (kg) : renseignez un poids strictement positif.");
  if (!Number.isFinite(loading.equipmentKg) || loading.equipmentKg < 0) throw new Error("Équipement (kg) : renseignez une masse positive ou nulle.");
  if (loading.expectedGasConsumptionKg !== undefined && (!Number.isFinite(loading.expectedGasConsumptionKg) || loading.expectedGasConsumptionKg < 0)) throw new Error("Gaz consommé prévu (kg) : valeur invalide.");
  if (loading.fuel && (!Number.isFinite(loading.fuel.propaneOnBoardKg) || loading.fuel.propaneOnBoardKg <= 0)) throw new Error("Propane embarqué (kg) : valeur invalide.");
  if (loading.fuel && loading.expectedGasConsumptionKg !== undefined && loading.expectedGasConsumptionKg > loading.fuel.propaneOnBoardKg) throw new Error("La consommation prévue dépasse le propane embarqué.");
  let passengersKg = 0;
  for (const row of active) {
    if (row.weightKg === null || !Number.isFinite(row.weightKg) || row.weightKg <= 0) throw new Error("Poids passager absent ou invalide.");
    passengersKg += row.weightKg;
  }
  const loadingKg = passengersKg + loading.pilotKg + loading.equipmentKg;
  if (!Number.isFinite(loadingKg)) throw new Error("Total de chargement invalide.");
  return { passengersKg, ...loading, loadingKg };
}

/** Morocco only: replace the old occupants total, never add to it or alter equipped balloon masses. */
export function applyMoroccoDossierLoading(input: MoroccoDossierPdfInput): MoroccoDossierPdfInput {
  if (!input.loading) return input; // Legacy documents without a passenger-loading contract retain their data.
  const total = calculateMoroccoLoading(input.passengers ?? [], input.loading);
  const original = input.loadInput;
  if (!original || !input.dossier.operations) throw new Error("Entrées du calcul de charge Maroc indisponibles : ouvrez le dossier depuis la préparation.");
  if (original.balloonId !== input.dossier.balloon.id || original.manufacturer !== input.dossier.balloon.manufacturer || original.model !== input.dossier.balloon.model || original.volumeM3 !== input.dossier.balloon.volumeM3) throw new Error("Ballon ou configuration changé : rouvrez le dossier Maroc et vérifiez les masses.");
  const equipped = balloonEquipmentWeightForLoad(input.dossier.balloon);
  if (equipped === null || !Number.isFinite(equipped) || equipped <= 0 || original.balloonEquipmentWeightKg === undefined || !Number.isFinite(original.balloonEquipmentWeightKg)) throw new Error("Masse du ballon équipé absente ou invalide : complétez Mes ballons.");
  if (Math.abs(equipped - original.balloonEquipmentWeightKg) > 1e-6) throw new Error("Masse du ballon équipé incohérente avec la préparation : rouvrez le dossier.");
  const load = prepareDossierLoad(input.dossier.balloon, { ...original, occupantsWeightKg: total.loadingKg }, input.dossier.operations.load.unavailableReason === "DEMO_DATA_EXCLUDED");
  const exceedsAltitude = original.plannedMaximumAltitudeMslM !== undefined && input.dossier.points.some(p => p.altitudeAmslM > original.plannedMaximumAltitudeMslM!);
  const guarded = exceedsAltitude ? { ...load, status: "UNAVAILABLE" as const, result: null, applicableLimitKg: null, marginKg: null, signedMarginKg: null,
    unavailableReason: "TRACE_EXCEEDS_LOAD_ALTITUDE", message: "La trace dépasse l’altitude maximale utilisée pour le calcul de charge ; limite et marge non applicables à cette stratégie." } : load;
  return { ...input, dossier: { ...input.dossier, operations: { ...input.dossier.operations, load: guarded } } };
}

/** Uses the existing takeoff total (which already contains full cylinders), never adds propane again. */
export function calculateMoroccoLandingMass(input: MoroccoDossierPdfInput) {
  const minimum = moroccoMinimumLandingMass(input.dossier.balloon, input.minimumLandingMassApplicability);
  const loading = input.loading, fuel = loading?.fuel, takeoffKg = input.dossier.operations?.load.plannedMassKg;
  const unavailable = (notice: string) => ({ takeoffKg, landingKg: null, propaneOnBoardKg: null, minimum, marginKg: null, notice });
  if (loading?.expectedGasConsumptionKg === undefined) return unavailable("Masse à l’atterrissage indisponible : gaz consommé prévu non renseigné.");
  if (!fuel?.fullCylinderMassesConfirmed || fuel.configurationKey !== moroccoLandingMassConfigurationKey(input.dossier.balloon)) return unavailable("Masse à l’atterrissage indisponible : masses réelles des cylindres, propane compris, et propane embarqué non confirmés pour cette configuration.");
  calculateMoroccoLoading(input.passengers ?? [], loading);
  const cylinders = input.dossier.balloon.weights.fullCylinders;
  const gross = cylinders.reduce((sum, c) => sum + c.fullWeightKg, 0);
  if (!cylinders.length || !Number.isFinite(gross) || fuel.propaneOnBoardKg > gross) return unavailable("Masse à l’atterrissage indisponible : masse de propane incohérente avec les cylindres pleins renseignés.");
  if (takeoffKg == null || !Number.isFinite(takeoffKg) || takeoffKg < loading.expectedGasConsumptionKg) return unavailable("Masse au décollage absente ou incohérente : estimation d’atterrissage indisponible.");
  const landingKg = takeoffKg - loading.expectedGasConsumptionKg;
  return { takeoffKg, landingKg, propaneOnBoardKg: fuel.propaneOnBoardKg, minimum, marginKg: minimum.kg === null ? null : landingKg - minimum.kg,
    notice: "Estimation : masse au décollage − gaz consommé prévu. Propane déjà compris dans les cylindres pleins, jamais ajouté une seconde fois. Consommation estimée par le pilote, non valeur constructeur." };
}

export type MoroccoPassengerDraft = { rows: MoroccoPassenger[]; weightDrafts: Record<number, string>; pilot: string; equipment: string; date: string; time: string;
  gas?: string; propane?: string; fuelConfirmed?: boolean; configurationKey?: string;
  mlmManualSha256?: string; mlmConfigurationReference?: string; minimumLandingMassApplicability?: MoroccoLandingMassApplicability };
export const moroccoPassengerDraftKey = (traceId: string, balloonId: string, startedAt: string) => `bc:morocco-passengers:v1:${JSON.stringify([traceId, balloonId, startedAt])}`;
export function saveMoroccoPassengerDraft(key: string, draft: MoroccoPassengerDraft, storage?: Pick<Storage, "setItem">): boolean {
  try { (storage ?? sessionStorage).setItem(key, JSON.stringify(draft)); return true; } catch { return false; }
}
export function readMoroccoPassengerDraft(key: string, storage?: Pick<Storage, "getItem">): MoroccoPassengerDraft | null {
  try {
    const d = JSON.parse((storage ?? sessionStorage).getItem(key) ?? "null");
    if (!d || !Array.isArray(d.rows) || d.rows.length !== 13 || !d.weightDrafts || [d.pilot, d.equipment, d.date, d.time].some(v => typeof v !== "string")) return null;
    if ([d.gas, d.propane, d.configurationKey].some(v => v !== undefined && typeof v !== "string") || (d.fuelConfirmed !== undefined && typeof d.fuelConfirmed !== "boolean")) return null;
    if ([d.mlmManualSha256, d.mlmConfigurationReference].some(v => v !== undefined && typeof v !== "string")) return null;
    if (d.rows.some((r: MoroccoPassenger) => !r || [r.lastName, r.firstName, r.nationality].some(v => typeof v !== "string") || !["", "H", "F", "E"].includes(r.sex))) return null;
    return { ...d, rows: d.rows.map((row: MoroccoPassenger, index: number) => ({ ...row,
      ...(typeof d.weightDrafts[index] === "string" ? { customWeightKg: parseMoroccoMass(d.weightDrafts[index]) } : row.customWeightKg === null ? { customWeightKg: NaN } : {}) })) };
  } catch { return null; }
}
