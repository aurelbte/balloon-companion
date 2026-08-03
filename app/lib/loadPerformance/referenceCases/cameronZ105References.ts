export type CameronZ105ReferenceCase = Readonly<{
  id: string;
  manufacturer: "Cameron";
  model: "Z105";
  volumeM3: number;
  applicableMtowKg: number;
  balloonEquipmentWeightKg: number;
  occupantsWeightKg: number;
  actualTotalMassKg: number;
  launchElevationMslM: number;
  plannedMaximumAltitudeMslM: number;
  groundTemperatureC: number;
  expectedOccupantsCapacityKg: number;
  expectedMarginKg: number;
  expectedPermittedTotalMassKg: number;
  sourceKind: "PILOT_VERIFIED_REFERENCE";
  sourceDescription: string;
  verifiedByPilot: true;
  verifiedAt: string;
}>;

export type CameronReferenceValidation = Readonly<{
  coherent: boolean;
  actualTotalMassKg: number;
  permittedTotalMassFromCapacityKg: number;
  marginFromCapacityKg: number;
  marginFromTotalsKg: number;
  errors: readonly string[];
}>;

/**
 * Cas métier vérifié par le pilote. Il valide uniquement la cohérence des masses :
 * il ne décrit ni une table de portance constructeur ni une interpolation officielle.
 */
export const CAMERON_Z105_REFERENCE_001: CameronZ105ReferenceCase = Object.freeze({
  id: "CAMERON_Z105_REFERENCE_001",
  manufacturer: "Cameron",
  model: "Z105",
  volumeM3: 2_974,
  applicableMtowKg: 952,
  balloonEquipmentWeightKg: 415,
  occupantsWeightKg: 330,
  actualTotalMassKg: 745,
  launchElevationMslM: 100,
  plannedMaximumAltitudeMslM: 500,
  groundTemperatureC: 14,
  expectedOccupantsCapacityKg: 410,
  expectedMarginKg: 80,
  expectedPermittedTotalMassKg: 825,
  sourceKind: "PILOT_VERIFIED_REFERENCE",
  sourceDescription: "Cas de référence fourni et validé par le pilote pour le banc de comparaison Cameron Z105.",
  verifiedByPilot: true,
  verifiedAt: "2026-08-01",
});

export const cameronZ105References: readonly CameronZ105ReferenceCase[] = Object.freeze([
  CAMERON_Z105_REFERENCE_001,
]);

export function validateCameronZ105Reference(reference: CameronZ105ReferenceCase): CameronReferenceValidation {
  const actualTotalMassKg = reference.balloonEquipmentWeightKg + reference.occupantsWeightKg;
  const permittedTotalMassFromCapacityKg = reference.balloonEquipmentWeightKg + reference.expectedOccupantsCapacityKg;
  const marginFromCapacityKg = reference.expectedOccupantsCapacityKg - reference.occupantsWeightKg;
  const marginFromTotalsKg = reference.expectedPermittedTotalMassKg - actualTotalMassKg;
  const errors: string[] = [];
  if (actualTotalMassKg !== reference.actualTotalMassKg) errors.push("La masse réelle ne correspond pas à équipement + occupants.");
  if (permittedTotalMassFromCapacityKg !== reference.expectedPermittedTotalMassKg) errors.push("La masse totale permise ne correspond pas à équipement + capacité occupants.");
  if (marginFromCapacityKg !== reference.expectedMarginKg) errors.push("La marge ne correspond pas à capacité occupants - occupants.");
  if (marginFromTotalsKg !== reference.expectedMarginKg) errors.push("La marge ne correspond pas à masse permise - masse réelle.");
  if (reference.expectedPermittedTotalMassKg > reference.applicableMtowKg) errors.push("La masse permise dépasse la MTOM applicable.");
  return { coherent: errors.length === 0, actualTotalMassKg, permittedTotalMassFromCapacityKg, marginFromCapacityKg, marginFromTotalsKg, errors };
}

export type ApplicableMtowBalance = Readonly<{
  tablePermittedTotalMassKg: number;
  permittedTotalMassKg: number;
  occupantsCapacityKg: number;
  actualTotalMassKg: number;
  marginKg: number;
  limitingRule: "CHARGE_CONDITIONS" | "APPLICABLE_MTOW";
}>;

/** Applique uniquement la limite de masse à un résultat de table déjà établi ailleurs. */
export function applyApplicableMtowLimit(input: Readonly<{
  tablePermittedTotalMassKg: number;
  applicableMtowKg: number;
  balloonEquipmentWeightKg: number;
  occupantsWeightKg: number;
}>): ApplicableMtowBalance {
  const permittedTotalMassKg = Math.min(input.tablePermittedTotalMassKg, input.applicableMtowKg);
  const actualTotalMassKg = input.balloonEquipmentWeightKg + input.occupantsWeightKg;
  return {
    tablePermittedTotalMassKg: input.tablePermittedTotalMassKg,
    permittedTotalMassKg,
    occupantsCapacityKg: permittedTotalMassKg - input.balloonEquipmentWeightKg,
    actualTotalMassKg,
    marginKg: permittedTotalMassKg - actualTotalMassKg,
    limitingRule: input.applicableMtowKg < input.tablePermittedTotalMassKg ? "APPLICABLE_MTOW" : "CHARGE_CONDITIONS",
  };
}

export const CAMERON_A2_METHOD_ACTIVATION_REQUIREMENTS = Object.freeze({
  minimumReferenceCases: 15,
  requiresTemperatureCoverage: true,
  requiresAltitudeCoverage: true,
  requiresMtomLimitedCases: true,
  requiresNearLimitCases: true,
  tolerancePolicy: "DOCUMENTED_ONLY",
});

/** Kept as an alias while dataset activation remains disabled. Cases validate the common method, not 15 Z-105 implementations. */
export const CAMERON_Z105_ACTIVATION_REQUIREMENTS = CAMERON_A2_METHOD_ACTIVATION_REQUIREMENTS;

export function auditCameronZ105ReferenceCoverage(references: readonly CameronZ105ReferenceCase[]): readonly string[] {
  const errors: string[] = [];
  if (references.length < CAMERON_A2_METHOD_ACTIVATION_REQUIREMENTS.minimumReferenceCases) errors.push(`Au moins ${CAMERON_A2_METHOD_ACTIVATION_REQUIREMENTS.minimumReferenceCases} cas de validation de la méthode A2 sont requis.`);
  if (!references.every((reference) => validateCameronZ105Reference(reference).coherent)) errors.push("Un ou plusieurs cas de référence sont arithmétiquement incohérents.");
  const distinctTemperatures = new Set(references.map(({ groundTemperatureC }) => groundTemperatureC));
  const distinctAltitudes = new Set(references.map(({ plannedMaximumAltitudeMslM }) => plannedMaximumAltitudeMslM));
  if (distinctTemperatures.size < 3) errors.push("La couverture de températures est insuffisante.");
  if (distinctAltitudes.size < 3) errors.push("La couverture d’altitudes est insuffisante.");
  if (!references.some((reference) => reference.expectedPermittedTotalMassKg === reference.applicableMtowKg)) errors.push("Aucun cas limité par la MTOM.");
  if (!references.some((reference) => Math.abs(reference.expectedMarginKg) <= 10)) errors.push("Aucun cas proche de la limite.");
  return errors;
}
