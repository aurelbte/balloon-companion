import { prepareMoroccoPassengers, type MoroccoDossierPdfInput, type MoroccoPassenger } from "./moroccoPassengers.ts";
import { prepareDossierLoad } from "./flightDossierOperations.ts";
import { balloonEquipmentWeightForLoad } from "./loadPerformance/balloonInput.ts";

export type MoroccoDossierLoading = { pilotKg: number; equipmentKg: number; passengerCount: number };
export const MOROCCO_LOADING_DEFAULTS = Object.freeze({ pilotKg: 60, equipmentKg: 5 });
export function parseMoroccoMass(raw: string): number {
  const text = raw.trim().replace(",", ".");
  return /^\d+(?:\.\d*)?$/.test(text) ? Number(text) : NaN;
}
export function calculateMoroccoLoading(passengers: readonly MoroccoPassenger[], loading: MoroccoDossierLoading) {
  const rows = prepareMoroccoPassengers(passengers), active = rows.filter(row => row.sex !== "");
  if (!Number.isInteger(loading.passengerCount) || loading.passengerCount !== active.length) throw new Error("Le nombre de passagers ne correspond pas au listing.");
  if (!Number.isFinite(loading.pilotKg) || loading.pilotKg <= 0) throw new Error("Pilote (kg) : renseignez un poids strictement positif.");
  if (!Number.isFinite(loading.equipmentKg) || loading.equipmentKg < 0) throw new Error("Équipement (kg) : renseignez une masse positive ou nulle.");
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
  const equipped = balloonEquipmentWeightForLoad(input.dossier.balloon);
  if (equipped === null || !Number.isFinite(equipped) || equipped <= 0 || original.balloonEquipmentWeightKg === undefined || !Number.isFinite(original.balloonEquipmentWeightKg)) throw new Error("Masse du ballon équipé absente ou invalide : complétez Mes ballons.");
  if (Math.abs(equipped - original.balloonEquipmentWeightKg) > 1e-6) throw new Error("Masse du ballon équipé incohérente avec la préparation : rouvrez le dossier.");
  const load = prepareDossierLoad(input.dossier.balloon, { ...original, occupantsWeightKg: total.loadingKg }, input.dossier.operations.load.unavailableReason === "DEMO_DATA_EXCLUDED");
  const exceedsAltitude = original.plannedMaximumAltitudeMslM !== undefined && input.dossier.points.some(p => p.altitudeAmslM > original.plannedMaximumAltitudeMslM!);
  const guarded = exceedsAltitude ? { ...load, status: "UNAVAILABLE" as const, result: null, applicableLimitKg: null, marginKg: null, signedMarginKg: null,
    unavailableReason: "TRACE_EXCEEDS_LOAD_ALTITUDE", message: "La trace dépasse l’altitude maximale utilisée pour le calcul de charge ; limite et marge non applicables à cette stratégie." } : load;
  return { ...input, dossier: { ...input.dossier, operations: { ...input.dossier.operations, load: guarded } } };
}

export type MoroccoPassengerDraft = { rows: MoroccoPassenger[]; weightDrafts: Record<number, string>; pilot: string; equipment: string; date: string; time: string };
export const moroccoPassengerDraftKey = (traceId: string, balloonId: string, startedAt: string) => `bc:morocco-passengers:v1:${JSON.stringify([traceId, balloonId, startedAt])}`;
export function saveMoroccoPassengerDraft(key: string, draft: MoroccoPassengerDraft, storage?: Pick<Storage, "setItem">): boolean {
  try { (storage ?? sessionStorage).setItem(key, JSON.stringify(draft)); return true; } catch { return false; }
}
export function readMoroccoPassengerDraft(key: string, storage?: Pick<Storage, "getItem">): MoroccoPassengerDraft | null {
  try {
    const d = JSON.parse((storage ?? sessionStorage).getItem(key) ?? "null");
    if (!d || !Array.isArray(d.rows) || d.rows.length !== 13 || !d.weightDrafts || [d.pilot, d.equipment, d.date, d.time].some(v => typeof v !== "string")) return null;
    if (d.rows.some((r: MoroccoPassenger) => !r || [r.lastName, r.firstName, r.nationality].some(v => typeof v !== "string") || !["", "H", "F", "E"].includes(r.sex))) return null;
    return { ...d, rows: d.rows.map((row: MoroccoPassenger, index: number) => ({ ...row,
      ...(typeof d.weightDrafts[index] === "string" ? { customWeightKg: parseMoroccoMass(d.weightDrafts[index]) } : row.customWeightKg === null ? { customWeightKg: NaN } : {}) })) };
  } catch { return null; }
}
