import type { LoadModelParameterSet } from "./types.ts";

export const ULTRAMAGIC_FM04_LIFT_PER_VOLUME_METHOD_ID = "ULTRAMAGIC_FM04_LIFT_PER_1000FT3";

/**
 * The H-65 is the worked example in FM04. Numeric chart digitisation is deliberately
 * absent: the source warns that graphical reading can differ from precise calculation.
 */
export const ultramagicModelParameters = Object.freeze([
  {
    id: "ULTRAMAGIC_H65_FM04_BASE",
    manufacturer: "Ultramagic",
    manufacturerModelId: "H-65",
    model: "H-65",
    manufacturerMethodId: ULTRAMAGIC_FM04_LIFT_PER_VOLUME_METHOD_ID,
    tableRowId: "FM04_VOLUME_MASS_TABLE_H65",
    source: {
      manualId: "ULTRAMAGIC_FM04_REV30",
      manualRevision: "FM04 Revision 30",
      pages: ["2.4", "5.3", "5.4", "5.5", "5.8", "5.9", "8.1", "9.1"],
    },
    verificationStatus: "PENDING_HUMAN_VERIFICATION",
    notes: [
      "La méthode graphique à 100 °C est commune au manuel de base.",
      "Le volume seul ne suffit pas : MTOM de variante, masse réelle, nacelle et suppléments restent applicables.",
    ],
  },
] satisfies readonly LoadModelParameterSet[]);
