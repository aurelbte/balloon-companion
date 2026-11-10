import type { DossierPdfInput } from "./flightDossierPdf.ts";

export const MOROCCO_PASSENGER_COUNT = 13;
export const MOROCCO_PASSENGER_WEIGHTS = Object.freeze({ H: 92, F: 74, E: 35 } as const);
export type MoroccoPassengerSex = "" | keyof typeof MOROCCO_PASSENGER_WEIGHTS;
export type MoroccoPassenger = Readonly<{ lastName: string; firstName: string; nationality: string; sex: MoroccoPassengerSex; customWeightKg?: number }>;
export type MoroccoDossierPdfInput = DossierPdfInput & { passengers?: readonly MoroccoPassenger[] };
export const emptyMoroccoPassengers = (): MoroccoPassenger[] => Array.from({ length: MOROCCO_PASSENGER_COUNT }, () => ({ lastName: "", firstName: "", nationality: "", sex: "" }));
export function moroccoPassengerWeight(sex: MoroccoPassengerSex, customWeightKg?: number): number | null {
  return customWeightKg !== undefined ? customWeightKg : sex === "" ? null : MOROCCO_PASSENGER_WEIGHTS[sex];
}

/** Explicit custom weights take priority; category defaults are used only without an override. */
export function prepareMoroccoPassengers(input: readonly MoroccoPassenger[] = []): readonly (MoroccoPassenger & { weightKg: number | null })[] {
  if (!Array.isArray(input) || input.length > MOROCCO_PASSENGER_COUNT) throw new Error("Le listing Maroc comporte au maximum 13 passagers.");
  return emptyMoroccoPassengers().map((empty, index) => {
    const row = input[index] ?? empty;
    if (!row || [row.lastName, row.firstName, row.nationality].some(value => typeof value !== "string") || !["", "H", "F", "E"].includes(row.sex)) throw new Error(`Passager ${index + 1} : données invalides.`);
    if (row.sex === "" && (row.customWeightKg !== undefined || [row.lastName, row.firstName, row.nationality].some(value => value.trim()))) throw new Error(`Passager ${index + 1} : choisissez H, F ou E pour calculer le poids.`);
    if (row.customWeightKg !== undefined && (typeof row.customWeightKg !== "number" || !Number.isFinite(row.customWeightKg) || row.customWeightKg <= 0)) throw new Error(`Passager ${index + 1} : le poids personnalisé doit être un nombre strictement positif.`);
    return { lastName: row.lastName, firstName: row.firstName, nationality: row.nationality, sex: row.sex, ...(row.customWeightKg === undefined ? {} : { customWeightKg: row.customWeightKg }), weightKg: moroccoPassengerWeight(row.sex, row.customWeightKg) };
  });
}
