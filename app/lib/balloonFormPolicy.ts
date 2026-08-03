import { proposedApplicableMtowKg } from "./loadPerformance/modelParameters/mtomCatalog.ts";

export function balloonFormSectionDefaults(hasMtom: boolean, limitsConfirmed: boolean): Readonly<{ identity: boolean; masses: boolean; limits: boolean; optionalDetails: boolean }> {
  return Object.freeze({ identity: true, masses: true, limits: !hasMtom || !limitsConfirmed, optionalDetails: false });
}

export type MtomFormTransition = Readonly<{
  value: string;
  fromCatalog: boolean;
  configurationLimitsConfirmed: false;
}>;

export function mtomAfterModelChange(
  currentValue: string,
  currentValueFromCatalog: boolean,
  manufacturer: string,
  model: string,
): MtomFormTransition {
  if (currentValue.trim() && !currentValueFromCatalog) {
    return { value: currentValue, fromCatalog: false, configurationLimitsConfirmed: false };
  }
  const proposal = proposedApplicableMtowKg(manufacturer, model);
  return {
    value: proposal === null ? "" : String(proposal),
    fromCatalog: proposal !== null,
    configurationLimitsConfirmed: false,
  };
}

export function mtomAfterManualChange(value: string): MtomFormTransition {
  return { value, fromCatalog: false, configurationLimitsConfirmed: false };
}
