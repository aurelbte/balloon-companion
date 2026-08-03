import type { LoadModelParameterSet } from "./types.ts";

export const CAMERON_METHOD_A2_ID = "CAMERON_HABFM_A2_DIRECT_FORMULA";
export const CAMERON_ISSUE_10_A18_REVISION = "Issue 10 Amendment 18";

const source = {
  manualId: "CAMERON_ISSUE_10_AMENDMENT_18",
  manualRevision: CAMERON_ISSUE_10_A18_REVISION,
  pages: ["2-6", "2-7", "5-1", "5-2", "9-1", "9-2", "9-3", "A2-1"] as const,
};

function cameronModel(model: string, size: number, volumeM3: number): LoadModelParameterSet {
  return Object.freeze({
    id: `CAMERON_${model.replaceAll("-", "_")}_${CAMERON_METHOD_A2_ID}`,
    manufacturer: "Cameron",
    manufacturerModelId: model,
    model,
    manufacturerMethodId: CAMERON_METHOD_A2_ID,
    volumeM3,
    maximumCalculationTemperatureC: 100,
    tableRowId: `CAMERON_SIZE_${size}`,
    source,
    verificationStatus: "VERIFIED_FROM_OFFICIAL_MANUAL",
    notes: [
      "Le volume et la taille proviennent des tables du manuel de base.",
      "La MTOM applicable et les limites panier/brûleur doivent être confirmées pour l'aéronef réel.",
    ],
  });
}

/** Modèles Z explicitement présents dans les tables du manuel de base vérifié. */
export const cameronModelParameters = Object.freeze([
  cameronModel("Z-90", 90, 2_549),
  cameronModel("Z-105", 105, 2_974),
  cameronModel("Z-120", 120, 3_398),
  cameronModel("Z-133", 133, 3_767),
  cameronModel("Z-150", 150, 4_248),
  cameronModel("Z-160", 160, 4_531),
  cameronModel("Z-180", 180, 5_098),
  cameronModel("Z-210", 210, 5_947),
  cameronModel("Z-250", 250, 7_080),
  cameronModel("Z-350", 350, 9_912),
  cameronModel("Z-425LW", 425, 12_036),
] satisfies readonly LoadModelParameterSet[]);

export const cameronZ105Parameters = cameronModelParameters.find(({ model }) => model === "Z-105")!;
