import { cameronZ105Parameters } from "./cameronModels.ts";

export type ApplicableMtomCatalogSuggestion = Readonly<{
  modelParameterSetId: string;
  applicableMtowKg: number;
  sourcePages: readonly string[];
  requiresConfigurationConfirmation: true;
}>;

/**
 * Catalogue de propositions uniquement. La valeur applicable à l'aéronef reste
 * modifiable et doit être confirmée par le pilote avec son manuel de vol.
 */
export const applicableMtomCatalogSuggestions = Object.freeze([
  {
    modelParameterSetId: cameronZ105Parameters.id,
    applicableMtowKg: 952,
    sourcePages: ["2-6", "2-7"],
    requiresConfigurationConfirmation: true,
  },
] satisfies readonly ApplicableMtomCatalogSuggestion[]);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function proposedApplicableMtowKg(manufacturer: string, model: string): number | null {
  if (normalize(manufacturer) !== "CAMERON" || normalize(model) !== "Z105") return null;
  return applicableMtomCatalogSuggestions.find(({ modelParameterSetId }) => modelParameterSetId === cameronZ105Parameters.id)?.applicableMtowKg ?? null;
}

export function resolveApplicableMtowSuggestion(
  currentValueKg: number | undefined,
  manufacturer: string,
  model: string,
): Readonly<{ valueKg: number | undefined; proposed: boolean }> {
  if (currentValueKg !== undefined) return { valueKg: currentValueKg, proposed: false };
  const proposal = proposedApplicableMtowKg(manufacturer, model);
  return proposal === null ? { valueKg: undefined, proposed: false } : { valueKg: proposal, proposed: true };
}
