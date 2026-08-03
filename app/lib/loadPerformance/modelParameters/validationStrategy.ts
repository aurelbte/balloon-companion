import type { FamilyValidationPlan, MethodValidationPlan, ModelValidationPlan } from "./types.ts";

/** Validation proposée, conservatrice, à faire approuver avant toute activation. */
export const officialLoadValidationStrategy = Object.freeze({
  method: {
    level: "METHOD",
    minimumCases: 15,
    coverage: [
      "bornes de température documentées",
      "bornes d'altitude documentées",
      "conditions nominales",
      "limitation par portance",
      "limitation par MTOM",
      "absence d'extrapolation",
    ],
  } satisfies MethodValidationPlan,
  familyOrTableRow: {
    level: "FAMILY_OR_TABLE_ROW",
    minimumCases: 3,
    coverage: ["borne basse", "interpolation ou point nominal", "borne haute"],
  } satisfies FamilyValidationPlan,
  modelParameterSet: {
    level: "MODEL_PARAMETER_SET",
    minimumCases: 2,
    coverage: ["identité, volume ou ligne de table", "limite MTOM/configuration"],
  } satisfies ModelValidationPlan,
});
