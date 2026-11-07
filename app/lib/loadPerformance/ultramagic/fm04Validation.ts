import type { LoadCalculationInput } from "../types.ts";
import { fm04BasketDefault, fm04BurnerDocumented, fm04Compatibility, fm04MinimumTom, normalizeFm04Identifier } from "./fm04Rules.ts";

/** Documentary evidence belongs to one aircraft/model/revision. No UI checkbox
 * supplies it implicitly; callers must obtain the aircraft's actual documents. */
export type UltramagicFm04Evidence = Readonly<{
  balloonId: string;
  model: string;
  manualRevision: "FM04_REVISION_30";
  buildStandard?: Readonly<{
    reference: string;
    basketType: string;
    basketSerialNumber: string;
    burnerModel: string; // Includes the array: Single / Double / Triple / Quad.
    maximumTakeoffMassKg: number;
    maximumLiftKg: number;
    otherEquipmentRequirementsVerified: boolean; // FDS, vents, cylinders, etc.
  }>;
  masses?: Readonly<{
    reference: string;
    complete: boolean;
    envelopeKg: number;
    emptyBasketKg: number;
    burnerKg: number;
    cylindersAndFuelKg: number;
    occupantsKg: number;
    baggageKg: number;
    accessoriesKg: number;
    basketCarriedKg: number; // Explicit actual load, EXCLUDING the empty basket.
  }>;
  basketPlate?: Readonly<{ reference: string; basketType: string; basketSerialNumber: string; maximumCarriedKg: number }>;
  landing?: Readonly<{ reference: string; complete: boolean; totalMassKg: number }>;
  supplements?: Readonly<{ reference: string; applicabilityVerified: boolean; requirementsVerified: boolean }>;
  reducedMtomApproval?: Readonly<{ logbookReference: string; mtomKg: number }>;
}>;
export type UltramagicCandidateInput = LoadCalculationInput & { fm04Evidence?: UltramagicFm04Evidence };
export type Fm04VerificationReason =
  | "EVIDENCE_IDENTITY_MISMATCH" | "BUILD_STANDARD_UNVERIFIED" | "BUILD_STANDARD_MTOM_EXCEEDED" | "BUILD_STANDARD_LMAX_EXCEEDED" | "TAKEOFF_EXCEEDS_APPLICABLE_MTOM"
  | "MINIMUM_TOM_UNVERIFIED" | "TAKEOFF_BELOW_MINIMUM_TOM" | "LANDING_MASS_UNVERIFIED" | "LANDING_BELOW_MINIMUM_TOM"
  | "BASKET_LIMIT_AND_COMPATIBILITY_UNVERIFIED" | "BASKET_PLATE_UNVERIFIED" | "BASKET_TYPE_UNDOCUMENTED"
  | "BASKET_CARRIED_MASS_UNVERIFIED" | "BASKET_LOAD_EXCEEDED" | "BASKET_INCOMPATIBLE"
  | "ENVELOPE_BASKET_COMPATIBILITY_UNVERIFIED" | "BURNER_COMPATIBILITY_UNVERIFIED" | "BURNER_INCOMPATIBLE"
  | "COMPLETE_MASSES_UNVERIFIED" | "APPLICABLE_SUPPLEMENTS_UNVERIFIED" | "EQUIPMENT_REQUIREMENTS_UNVERIFIED"
  | "REDUCED_MTOM_DOCUMENTATION_UNVERIFIED";
const reference = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const positive = (value: unknown): value is number => nonnegative(value) && value > 0;
const sameMass = (a: number, b: number) => Math.abs(a - b) <= 1e-7; // Floating arithmetic only, not a manufacturer tolerance.

/** Check documented constraints, never certify the candidate lift reconstruction. */
export function evaluateFm04Evidence(input: UltramagicCandidateInput) {
  const reasons: Fm04VerificationReason[] = [];
  const supplied = input.fm04Evidence;
  const identityMatches = supplied && reference(input.balloonId) && supplied.balloonId === input.balloonId
    && normalizeFm04Identifier(supplied.model) === normalizeFm04Identifier(input.model)
    && supplied.manualRevision === "FM04_REVISION_30";
  if (supplied && !identityMatches) reasons.push("EVIDENCE_IDENTITY_MISMATCH");
  const evidence = identityMatches ? supplied : undefined;
  const build = evidence?.buildStandard;
  const buildVerified = !!build && reference(build.reference) && reference(build.basketType)
    && reference(build.basketSerialNumber) && positive(build.maximumTakeoffMassKg) && positive(build.maximumLiftKg);
  if (!buildVerified) reasons.push("BUILD_STANDARD_UNVERIFIED");
  if (buildVerified && positive(input.applicableMtowKg) && input.applicableMtowKg > build.maximumTakeoffMassKg) reasons.push("BUILD_STANDARD_MTOM_EXCEEDED");
  if (!buildVerified || build.otherEquipmentRequirementsVerified !== true) reasons.push("EQUIPMENT_REQUIREMENTS_UNVERIFIED");

  const masses = evidence?.masses;
  const quantities = masses ? [masses.envelopeKg, masses.emptyBasketKg, masses.burnerKg, masses.cylindersAndFuelKg, masses.occupantsKg, masses.baggageKg, masses.accessoriesKg, masses.basketCarriedKg] : [];
  const equipmentKg = masses ? masses.envelopeKg + masses.emptyBasketKg + masses.burnerKg + masses.cylindersAndFuelKg : NaN;
  const takeoffKg = masses ? equipmentKg + masses.occupantsKg + masses.baggageKg + masses.accessoriesKg : NaN;
  const massesVerified = !!masses && reference(masses.reference) && masses.complete === true
    && quantities.every(nonnegative) && positive(masses.envelopeKg) && positive(masses.emptyBasketKg) && positive(masses.burnerKg)
    && Number.isFinite(equipmentKg) && Number.isFinite(takeoffKg)
    && nonnegative(input.balloonEquipmentWeightKg) && sameMass(equipmentKg, input.balloonEquipmentWeightKg)
    && nonnegative(input.occupantsWeightKg) && sameMass(masses.occupantsKg, input.occupantsWeightKg)
    && masses.basketCarriedKg >= masses.occupantsKg
    && masses.basketCarriedKg <= takeoffKg - masses.emptyBasketKg - masses.envelopeKg + 1e-7;
  if (!massesVerified) reasons.push("COMPLETE_MASSES_UNVERIFIED", "BASKET_CARRIED_MASS_UNVERIFIED");
  if (massesVerified && positive(input.applicableMtowKg) && takeoffKg > input.applicableMtowKg) reasons.push("TAKEOFF_EXCEEDS_APPLICABLE_MTOM");
  if (buildVerified && massesVerified && takeoffKg > build.maximumLiftKg) reasons.push("BUILD_STANDARD_LMAX_EXCEEDED");
  const minimum = fm04MinimumTom(input.model ?? "");
  if (!minimum || minimum.state === "NOT_INDICATED") reasons.push("MINIMUM_TOM_UNVERIFIED");
  if (minimum?.state === "NUMERIC") {
    if (massesVerified && takeoffKg < minimum.kg) reasons.push("TAKEOFF_BELOW_MINIMUM_TOM");
    if (minimum.landingSource) {
      const landing = evidence?.landing;
      if (!landing || !reference(landing.reference) || landing.complete !== true || !nonnegative(landing.totalMassKg)) reasons.push("LANDING_MASS_UNVERIFIED");
      else if (landing.totalMassKg < minimum.kg) reasons.push("LANDING_BELOW_MINIMUM_TOM");
    }
  }

  const plate = evidence?.basketPlate;
  const plateVerified = buildVerified && !!plate && reference(plate.reference)
    && plate.basketSerialNumber === build.basketSerialNumber
    && normalizeFm04Identifier(plate.basketType) === normalizeFm04Identifier(build.basketType) && positive(plate.maximumCarriedKg);
  if (!plateVerified) reasons.push("BASKET_PLATE_UNVERIFIED");
  if (buildVerified && fm04BasketDefault(build.basketType).state === "NOT_DOCUMENTED") reasons.push("BASKET_TYPE_UNDOCUMENTED");
  // Never replace the plate with the default table, nor compare it with gross TOM.
  if (plateVerified && massesVerified && masses.basketCarriedKg > plate.maximumCarriedKg) reasons.push("BASKET_LOAD_EXCEEDED");
  const row = fm04Compatibility(input.model ?? "");
  if (!buildVerified || !row || !row.baskets.length) reasons.push("ENVELOPE_BASKET_COMPATIBILITY_UNVERIFIED");
  else if (!row.baskets.includes(normalizeFm04Identifier(build.basketType))) reasons.push("BASKET_INCOMPATIBLE");
  if (!buildVerified || !row || !reference(build.burnerModel) || !fm04BurnerDocumented(build.burnerModel)) reasons.push("BURNER_COMPATIBILITY_UNVERIFIED");
  else if (!row.burners.includes(normalizeFm04Identifier(build.burnerModel))) reasons.push("BURNER_INCOMPATIBLE");
  if (reasons.some((reason) => ["BASKET_PLATE_UNVERIFIED", "BASKET_TYPE_UNDOCUMENTED", "BASKET_CARRIED_MASS_UNVERIFIED", "BASKET_LOAD_EXCEEDED", "ENVELOPE_BASKET_COMPATIBILITY_UNVERIFIED", "BASKET_INCOMPATIBLE", "BURNER_COMPATIBILITY_UNVERIFIED", "BURNER_INCOMPATIBLE"].includes(reason))) reasons.push("BASKET_LIMIT_AND_COMPATIBILITY_UNVERIFIED");
  const supplements = evidence?.supplements;
  if (!supplements || !reference(supplements.reference) || supplements.applicabilityVerified !== true || supplements.requirementsVerified !== true) reasons.push("APPLICABLE_SUPPLEMENTS_UNVERIFIED");
  return { reasons, takeoffMassKg: massesVerified ? takeoffKg : undefined,
    buildStandardMassCeilingKg: buildVerified ? Math.min(build.maximumTakeoffMassKg, build.maximumLiftKg) : undefined,
    reducedMtomApproval: evidence?.reducedMtomApproval,
  };
}
