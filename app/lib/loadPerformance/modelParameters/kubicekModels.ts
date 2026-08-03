import type { LoadModelParameterSet } from "./types.ts";

export const KUBICEK_LIFT_UNITS_METHOD_ID = "KUBICEK_B3102_LIFT_UNITS_TABLE";

/**
 * First audited table-row mapping. More rows must be transcribed and independently
 * checked before this registry can claim exhaustive B.3102 coverage.
 */
export const kubicekModelParameters = Object.freeze([
  {
    id: "KUBICEK_BB20_B3102_ROW_BB20",
    manufacturer: "Kubíček",
    manufacturerModelId: "BB20",
    model: "BB20",
    manufacturerMethodId: KUBICEK_LIFT_UNITS_METHOD_ID,
    tableRowId: "B3102_LOADING_TABLE_BB20",
    source: {
      manualId: "KUBICEK_B3102_ED3_REV22",
      manualRevision: "Edition 3 Revision 22",
      pages: ["2-4", "2-5", "5-1", "5-2", "5-4", "5-5"],
    },
    verificationStatus: "PENDING_HUMAN_VERIFICATION",
    notes: [
      "Le manuel impose une interpolation entre colonnes de Lift Units.",
      "MTOW/RMTOW, capacité nacelle et compatibilité brûleur restent propres à la configuration.",
    ],
  },
] satisfies readonly LoadModelParameterSet[]);
