/** Dataset de production toujours désactivé : les données ci-dessous restent documentaires. */
export const kubicekB3102Ed3Rev22Rows = [] as const;

export const kubicekB3102Ed3Rev22Source = {
  manualId: "KUBICEK_B3102_ED3_REV22",
  manualRevision: "Edition 3 Revision 22 — 30 October 2025",
  localManualPath: ".load-performance-work/manuals/kubicek-b3102-rev22.pdf",
  sha256: "c32dd501b7761b1b03974aa8e39b6d4e20efc9e304c1a520ecc37c03bf721c30",
  pageRevisions: {
    "2-5": { revision: 22, date: "2025-10-30", subject: "Envelope Weight Limits" },
    "2-9": { revision: 22, date: "2025-10-30", subject: "Envelope / basket combinations" },
    "2-10": { revision: 22, date: "2025-10-30", subject: "Burner frame / envelope combinations" },
    "2-11": { revision: 22, date: "2025-10-30", subject: "Envelope / burner combinations" },
    "5-4": { revision: 22, date: "2025-10-30", subject: "Loading Table kg (10–23 LU)" },
    "5-5": { revision: 22, date: "2025-10-30", subject: "Loading Table lb (not used in calculation)" },
    "8-1": { revision: 15, date: "2023-02-27", subject: "Envelope volumes" },
    "8-2": { revision: 22, date: "2025-10-30", subject: "Envelope volumes" },
  },
  // 79 lignes / 1106 valeurs kg revérifiées : aucune modification numérique.
  unchangedLegacyModelCount: 79,
  unchangedLegacyValueCount: 1106,
  // Le graphique LU reste l'extraction Rev.19, page 5-3 Rev.17 : validation séparée requise.
  loadingChartChanged: false,
} as const;

/** Références de matrice uniquement : ne constituent pas une configuration approuvée. */
export const kubicekBB74ZDocumentation = {
  model: "BB74Z",
  volumeM3: 7400,
  volumeCuFt: 263400,
  mtowKg: 2450,
  minimumLandingWeightKg: 1130,
  basketMatrix: { page: "2-9", revision: 22, row: ["BB70D", "BB70Z", "BB74Z"] },
  burnerMatrix: { page: "2-11", revision: 22, row: ["BB74Z", "BB78Z"] },
  burnerFrameMatrix: { page: "2-10", revision: 22 },
  configurationStatus: "NOT_VERIFIED",
  requiredChecks: [
    "Cellules approuvées et exigences RV de la nacelle réelle (2-9).",
    "Type de cadre brûleur, limite de vent et volume ; K50 exige le marquage S/N de 7400 à 9200 m³ (2-10).",
    "Cellule du brûleur réel et condition Ignis S/N 516+ lorsqu'elle s'applique (2-11).",
    "Masses complètes, MTOW/RMTOW individuelle, MLW, limites nacelle et suppléments applicables.",
  ],
} as const;
