import type { LoadModelParameterSet } from "./types.ts";

export const KUBICEK_LIFT_UNITS_METHOD_ID = "KUBICEK_B3102_LIFT_UNITS_TABLE";
export const KUBICEK_B3102_ED3_REV19_SOURCE_URL =
  "https://kubicekballoons.com/runtime/cache/files/original/b/b.3102-fm-edition-3-rev19-eu-20241219114205.pdf";

type KubicekEnvelopeRow = Readonly<{
  models: readonly string[];
  volumeM3: number;
  volumeCuFt: number;
  mtowKg: number;
}>;

const envelopeRows: readonly KubicekEnvelopeRow[] = [
  { models: ["BB9", "BB9E", "BB9EF"], volumeM3: 900, volumeCuFt: 31_800, mtowKg: 295 },
  { models: ["BB12", "BB12E", "BB12EF"], volumeM3: 1_200, volumeCuFt: 42_700, mtowKg: 385 },
  { models: ["BB14XR"], volumeM3: 1_400, volumeCuFt: 49_400, mtowKg: 420 },
  { models: ["BB16", "BB16E", "BB16EF", "BB16XR"], volumeM3: 1_600, volumeCuFt: 57_000, mtowKg: 470 },
  { models: ["BB17GP", "BB17XR"], volumeM3: 1_700, volumeCuFt: 59_900, mtowKg: 495 },
  { models: ["BB18E"], volumeM3: 1_800, volumeCuFt: 64_100, mtowKg: 550 },
  { models: ["BB18XR"], volumeM3: 1_800, volumeCuFt: 64_100, mtowKg: 570 },
  { models: ["BB20", "BB20E", "BB20ED"], volumeM3: 2_000, volumeCuFt: 71_200, mtowKg: 630 },
  { models: ["BB20GP", "BB20XR"], volumeM3: 2_000, volumeCuFt: 71_200, mtowKg: 730 },
  { models: ["BB22E", "BB22ED"], volumeM3: 2_200, volumeCuFt: 78_200, mtowKg: 680 },
  { models: ["BB22M"], volumeM3: 2_200, volumeCuFt: 78_300, mtowKg: 680 },
  { models: ["BB22", "BB22N", "BB22Z"], volumeM3: 2_200, volumeCuFt: 78_300, mtowKg: 730 },
  { models: ["BB22D"], volumeM3: 2_200, volumeCuFt: 78_200, mtowKg: 730 },
  { models: ["BB22XR"], volumeM3: 2_200, volumeCuFt: 78_300, mtowKg: 780 },
  { models: ["BB26E", "BB26ED", "BB26M"], volumeM3: 2_600, volumeCuFt: 92_500, mtowKg: 730 },
  { models: ["BB26", "BB26D", "BB26N", "BB26Z", "BB26XR"], volumeM3: 2_600, volumeCuFt: 92_500, mtowKg: 840 },
  { models: ["BB30E", "BB30ED", "BB30M"], volumeM3: 3_000, volumeCuFt: 106_800, mtowKg: 840 },
  { models: ["BB30D", "BB30N", "BB30Z", "BB30XR"], volumeM3: 3_000, volumeCuFt: 106_800, mtowKg: 945 },
  { models: ["BB34E", "BB34ED"], volumeM3: 3_400, volumeCuFt: 121_000, mtowKg: 945 },
  { models: ["BB34D", "BB34Z"], volumeM3: 3_400, volumeCuFt: 121_000, mtowKg: 1_040 },
  { models: ["BB37D", "BB37N", "BB37Z"], volumeM3: 3_700, volumeCuFt: 131_700, mtowKg: 1_150 },
  { models: ["BB40D", "BB40Z"], volumeM3: 4_000, volumeCuFt: 142_400, mtowKg: 1_310 },
  { models: ["BB42D", "BB42Z"], volumeM3: 4_250, volumeCuFt: 151_300, mtowKg: 1_410 },
  { models: ["BB45D", "BB45N", "BB45Z"], volumeM3: 4_500, volumeCuFt: 160_200, mtowKg: 1_520 },
  { models: ["BB51D", "BB51Z"], volumeM3: 5_100, volumeCuFt: 181_500, mtowKg: 1_690 },
  { models: ["BB60D"], volumeM3: 6_000, volumeCuFt: 213_600, mtowKg: 1_940 },
  { models: ["BB60N"], volumeM3: 6_000, volumeCuFt: 213_600, mtowKg: 1_940 },
  { models: ["BB60Z"], volumeM3: 5_950, volumeCuFt: 209_700, mtowKg: 1_940 },
  { models: ["BB64Z"], volumeM3: 6_400, volumeCuFt: 227_900, mtowKg: 2_100 },
  { models: ["BB70D", "BB70Z"], volumeM3: 7_000, volumeCuFt: 249_200, mtowKg: 2_300 },
  { models: ["BB78Z"], volumeM3: 7_800, volumeCuFt: 277_600, mtowKg: 2_600 },
  { models: ["BB85D", "BB85Z"], volumeM3: 8_500, volumeCuFt: 302_600, mtowKg: 2_820 },
  { models: ["BB92Z"], volumeM3: 9_200, volumeCuFt: 327_500, mtowKg: 3_000 },
  { models: ["BB100D", "BB100Z"], volumeM3: 10_000, volumeCuFt: 353_100, mtowKg: 3_200 },
  { models: ["BB105P"], volumeM3: 10_500, volumeCuFt: 373_700, mtowKg: 3_500 },
  { models: ["BB106P"], volumeM3: 10_600, volumeCuFt: 377_300, mtowKg: 3_500 },
  { models: ["BB113P"], volumeM3: 11_300, volumeCuFt: 402_200, mtowKg: 3_600 },
  { models: ["BB120P"], volumeM3: 12_000, volumeCuFt: 423_800, mtowKg: 3_700 },
  { models: ["BB130P"], volumeM3: 13_000, volumeCuFt: 462_700, mtowKg: 4_200 },
  { models: ["BB142P"], volumeM3: 14_200, volumeCuFt: 500_000, mtowKg: 4_500 },
  { models: ["BB150P"], volumeM3: 15_000, volumeCuFt: 530_000, mtowKg: 4_800 },
  { models: ["BB184P"], volumeM3: 18_400, volumeCuFt: 650_000, mtowKg: 5_095 },
];

export const kubicekModelParameters = Object.freeze(
  envelopeRows.flatMap((row) => row.models.map((model) => ({
    id: `KUBICEK_${model}_B3102_ED3_REV19`,
    manufacturer: "Kubíček" as const,
    manufacturerModelId: model,
    model,
    manufacturerMethodId: KUBICEK_LIFT_UNITS_METHOD_ID,
    volumeM3: row.volumeM3,
    volumeCuFt: row.volumeCuFt,
    standardMtomKg: row.mtowKg,
    tableRowId: `B3102_LOADING_TABLE_${model}`,
    source: {
      manualId: "KUBICEK_B3102_ED3_REV19",
      manualRevision: "Edition 3 Revision 19 — 18 December 2024",
      pages: ["2-5", "5-4", "5-5", "8-1", "8-2"],
    },
    verificationStatus: "CANDIDATE_PILOT_VALIDATION" as const,
    notes: [
      "MTOW issue de la table Envelope Weight Limits ; aucune RMTOW générique.",
      "La RMTOW éventuelle est propre au ballon et inscrite en page II.",
    ],
  } satisfies LoadModelParameterSet))),
);

/** Résolution volontairement exacte : aucune variante proche n'est assimilée. */
export function findExactKubicekModel(model: string): LoadModelParameterSet | undefined {
  return kubicekModelParameters.find((entry) => entry.model === model);
}
