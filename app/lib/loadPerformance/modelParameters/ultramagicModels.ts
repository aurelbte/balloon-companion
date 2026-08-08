import type { LoadModelParameterSet } from "./types.ts";

export const ULTRAMAGIC_FM04_LIFT_PER_VOLUME_METHOD_ID = "ULTRAMAGIC_FM04_LIFT_PER_1000FT3";
export const ULTRAMAGIC_FM04_REVISION = "FM04_REVISION_30";

const MODELS_ON_TABLE_5_1 = new Set([
  "V25", "H31", "H42", "M42", "H56", "V56", "M56", "M56C", "M56Z", "M60Z",
  "H65", "V65", "M65", "M65C", "M65Z", "M70Z", "M74Z", "H77", "V77", "M77",
  "M77C", "S90", "V90", "M90", "Z90",
]);
const MODELS_ON_COMPATIBILITY_5_6 = new Set([
  ...MODELS_ON_TABLE_5_1,
  "S105", "V105", "M105", "M120", "S130", "M130", "M145", "T150", "S160", "M160",
]);

type UltramagicRegistryRow = readonly [
  model: string,
  volumeM3: number,
  standardMtomKg: number,
  reducedMtomKg: number,
];

const rows: readonly UltramagicRegistryRow[] = [
  ["H31", 900, 307, 295], ["H42", 1_200, 416, 399], ["H56", 1_590, 549, 532],
  ["H65", 1_840, 638, 618], ["H77", 2_190, 756, 732],
  ["S90", 2_550, 878, 855], ["S105", 2_950, 1_032, 998], ["S130", 3_680, 1_365, 1_235],
  ["S160", 4_550, 1_569, 1_506],
  ["V25", 708, 250, 238], ["V56", 1_650, 549, 532], ["V65", 1_840, 638, 618],
  ["V77", 2_190, 756, 732], ["V90", 2_550, 878, 855], ["V105", 2_950, 1_032, 998],
  ["M42", 1_200, 414, 399], ["M56", 1_590, 550, 532], ["M56C", 1_590, 550, 532],
  ["M65", 1_840, 638, 618], ["M65C", 1_840, 635, 618], ["M77", 2_200, 756, 732],
  ["M77C", 2_200, 756, 732], ["M90", 2_550, 880, 855], ["M105", 2_950, 1_032, 998],
  ["M120", 3_400, 1_173, 1_140], ["M130", 3_680, 1_365, 1_235], ["M145", 4_105, 1_436, 1_378],
  ["M160", 4_550, 1_569, 1_506], ["M56Z", 1_590, 549, 531], ["M60Z", 1_700, 588, 568],
  ["M65Z", 1_840, 636, 615], ["M70Z", 1_980, 686, 663], ["M74Z", 2_100, 710, 687],
  ["N180", 5_100, 1_754, 1_710], ["N210", 6_000, 2_064, 1_995], ["N250", 7_000, 2_408, 2_375],
  ["N300", 8_500, 2_924, 2_845], ["N355", 10_000, 3_450, 3_373], ["N370", 10_480, 3_450, 3_370],
  ["N390", 11_045, 3_795, 3_552], ["N415", 11_750, 3_950, 3_780], ["N425", 12_000, 4_140, 3_995],
  ["N450", 12_750, 4_140, 3_995], ["N500", 14_415, 5_000, 3_995], ["N550", 15_574, 5_000, 4_100],
  ["Z90", 2_550, 894, 855], ["G90", 2_550, 878, 855],
  ["T150", 4_245, 1_465, 1_425], ["T180", 5_100, 1_754, 1_710], ["T210", 6_000, 2_070, 1_995],
];

/** Registre documentaire uniquement : aucune entrée n'est activée pour un calcul. */
export const ultramagicModelParameters = Object.freeze(rows.map(([
  model,
  volumeM3,
  standardMtomKg,
  reducedMtomKg,
]): LoadModelParameterSet => Object.freeze({
  id: `ULTRAMAGIC_${model}`,
  manufacturer: "Ultramagic",
  manufacturerModelId: model,
  model,
  manufacturerMethodId: ULTRAMAGIC_FM04_LIFT_PER_VOLUME_METHOD_ID,
  volumeM3,
  standardMtomKg,
  reducedMtomKg,
  tableRowId: `ULTRAMAGIC_FM04_${model}`,
  source: {
    manualId: "ULTRAMAGIC_FM04_REV30",
    manualRevision: ULTRAMAGIC_FM04_REVISION,
    pages: [
      MODELS_ON_TABLE_5_1.has(model) ? "5.1" : "5.2",
      "5.3–5.5",
      MODELS_ON_COMPATIBILITY_5_6.has(model) ? "5.6" : "5.7",
      "5.8",
      "5.9",
    ],
  },
  verificationStatus: "CANDIDATE_PILOT_VALIDATION",
  notes: ["Paramètres tracés dans FM04 Rev.30 ; la configuration réelle du ballon reste à confirmer."],
})));

export type UltramagicTraceabilityAuditRow = Readonly<{
  model: string;
  volume: "CONFIRMED";
  mtom: "STANDARD_AND_REDUCED_DOCUMENTED";
  fm04: "APPLICABLE";
  supplement: "NOT_REQUIRED";
  status: "CANDIDATE_PILOT_VALIDATION";
}>;

export function buildUltramagicTraceabilityAudit(): readonly UltramagicTraceabilityAuditRow[] {
  return ultramagicModelParameters.map((entry) => ({
    model: entry.model,
    volume: "CONFIRMED",
    mtom: "STANDARD_AND_REDUCED_DOCUMENTED",
    fm04: "APPLICABLE",
    supplement: "NOT_REQUIRED",
    status: "CANDIDATE_PILOT_VALIDATION",
  }));
}
