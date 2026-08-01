export type OfficialLoadDataset = {
  id: string;
  manufacturer: "Cameron" | "Kubíček" | "Ultramagic";
  supportedModels: readonly string[];
  manualTitle: string;
  manualEdition: string;
  manualRevision: string;
  revisionDate: string;
  sourceUrl: string;
  sourcePages: readonly string[];
  authorityStatus: "OFFICIAL_SOURCE";
  units: { altitude: "m AMSL"; temperature: "°C"; mass: "kg" };
  interpolationPolicy: "NOT_IMPLEMENTED" | "DOCUMENTED_ONLY";
  extrapolationAllowed: false;
  parserVersion: string;
  sourceFingerprint: string;
  verifiedAt?: string;
  verifiedBy?: string;
  goldenTestIds: readonly string[];
  enabled: boolean;
  blockedReason?: string;
};

export const officialLoadDatasets: readonly OfficialLoadDataset[] = [
  {
    id: "CAMERON_ISSUE_10_AMENDMENT_18",
    manufacturer: "Cameron",
    supportedModels: [],
    manualTitle: "Cameron Balloons Hot Air Balloon Flight Manual",
    manualEdition: "Issue 10",
    manualRevision: "Amendment 18",
    revisionDate: "2022-07-05",
    sourceUrl: "https://www.cameronballoons.co.uk/c/download/Hot-Air-Balloon-Flight-Manual-Amendment-18-Updated-pages-only.pdf",
    sourcePages: ["9-3 (applicabilité des enveloppes uniquement)"],
    authorityStatus: "OFFICIAL_SOURCE",
    units: { altitude: "m AMSL", temperature: "°C", mass: "kg" },
    interpolationPolicy: "NOT_IMPLEMENTED",
    extrapolationAllowed: false,
    parserVersion: "1",
    sourceFingerprint: "cameron-issue10-amendment18-2022-07-05",
    goldenTestIds: [],
    enabled: false,
    blockedReason: "Tables de portance et golden test officiel non encore intégrés et vérifiés.",
  },
  {
    id: "KUBICEK_B3102_ED3_REV22",
    manufacturer: "Kubíček",
    supportedModels: [],
    manualTitle: "Kubíček B.3102 Flight Manual",
    manualEdition: "Edition 3",
    manualRevision: "Revision 22",
    revisionDate: "2025-10-30",
    sourceUrl: "https://www.kubicekballoons.cz/runtime/cache/files/original/b/b.3102-fm-edition-3-rev22-eu-20251112083924.pdf",
    sourcePages: ["II", "0-III à 0-IV (identification et historique de révision uniquement)"],
    authorityStatus: "OFFICIAL_SOURCE",
    units: { altitude: "m AMSL", temperature: "°C", mass: "kg" },
    interpolationPolicy: "NOT_IMPLEMENTED",
    extrapolationAllowed: false,
    parserVersion: "1",
    sourceFingerprint: "kubicek-b3102-ed3-rev22-2025-10-30",
    goldenTestIds: [],
    enabled: false,
    blockedReason: "Tables de charge, applicabilité par configuration et golden test officiel à valider.",
  },
  {
    id: "ULTRAMAGIC_FM04_REV30",
    manufacturer: "Ultramagic",
    supportedModels: [],
    manualTitle: "Ultramagic Hot Air Balloon Flight Manual FM04",
    manualEdition: "FM04",
    manualRevision: "Revision 30",
    revisionDate: "2026-03",
    sourceUrl: "https://ultramagic.com/openfiles/Manuals04/MV04ar30.pdf",
    sourcePages: ["5.8", "Annexe A"],
    authorityStatus: "OFFICIAL_SOURCE",
    units: { altitude: "m AMSL", temperature: "°C", mass: "kg" },
    interpolationPolicy: "NOT_IMPLEMENTED",
    extrapolationAllowed: false,
    parserVersion: "1",
    sourceFingerprint: "ultramagic-fm04-rev30",
    goldenTestIds: [],
    enabled: false,
    blockedReason: "Graphiques sans table numérique officielle suffisamment précise pour une intégration sûre.",
  },
] as const;

export const enabledOfficialLoadDatasets = officialLoadDatasets.filter(
  ({ enabled }) => enabled,
);

export function validateOfficialLoadDatasets(
  datasets: readonly OfficialLoadDataset[] = officialLoadDatasets,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const dataset of datasets) {
    if ((dataset as { authorityStatus?: string }).authorityStatus === "DEMO_ONLY") errors.push(`${dataset.id}: un dataset DEMO est interdit dans la liste officielle`);
    if (ids.has(dataset.id)) errors.push(`Identifiant dupliqué : ${dataset.id}`);
    ids.add(dataset.id);
    if (!dataset.sourceUrl) errors.push(`${dataset.id}: source absente`);
    if (!dataset.manualRevision) errors.push(`${dataset.id}: révision absente`);
    if (dataset.extrapolationAllowed) errors.push(`${dataset.id}: extrapolation interdite`);
    if (!dataset.sourceFingerprint) errors.push(`${dataset.id}: empreinte ou version source absente`);
    if (dataset.enabled) {
      if (!dataset.revisionDate) errors.push(`${dataset.id}: date de révision absente`);
      if (dataset.supportedModels.length === 0) errors.push(`${dataset.id}: aucun modèle activé`);
      if (dataset.sourcePages.length === 0) errors.push(`${dataset.id}: pages source absentes`);
      if (dataset.interpolationPolicy === "NOT_IMPLEMENTED") errors.push(`${dataset.id}: interpolation non implémentée`);
      if (dataset.goldenTestIds.length === 0) errors.push(`${dataset.id}: golden test absent`);
      if (!dataset.verifiedAt || !dataset.verifiedBy) errors.push(`${dataset.id}: vérification absente`);
    }
  }
  return errors;
}
