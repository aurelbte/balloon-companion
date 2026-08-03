import { cameronZ105Official } from "./datasets/cameronZ105Official.ts";
import { auditCameronZ105ReferenceCoverage, cameronZ105References } from "./referenceCases/cameronZ105References.ts";

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
    supportedModels: ["Z105"],
    manualTitle: "Cameron Balloons Hot Air Balloon Flight Manual",
    manualEdition: "Issue 10",
    manualRevision: "Amendment 18",
    revisionDate: "2022-07-05",
    sourceUrl: "https://www.cameronballoons.co.uk/c/download/Hot-Air-Balloon-Flight-Manual-Amendment-18.pdf",
    sourcePages: ["5-1 à 5-4", "A2-1"],
    authorityStatus: "OFFICIAL_SOURCE",
    units: { altitude: "m AMSL", temperature: "°C", mass: "kg" },
    interpolationPolicy: "DOCUMENTED_ONLY",
    extrapolationAllowed: false,
    parserVersion: "1",
    sourceFingerprint: "sha256:a2bb81dd8cff59771381a580812ce6e9878c74b0c0aa450981c219abba1b8572",
    goldenTestIds: ["CAMERON_Z105_REFERENCE_001"],
    enabled: false,
    blockedReason: "Méthode commune A2 transcrite ; validation méthode, validation ciblée Z105 et double validation humaine encore requises.",
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
    sourcePages: ["2-4", "2-5", "2-10", "5-1 à 5-5", "6-1"],
    authorityStatus: "OFFICIAL_SOURCE",
    units: { altitude: "m AMSL", temperature: "°C", mass: "kg" },
    interpolationPolicy: "NOT_IMPLEMENTED",
    extrapolationAllowed: false,
    parserVersion: "1",
    sourceFingerprint: "sha256:c32dd501b7761b1b03974aa8e39b6d4e20efc9e304c1a520ecc37c03bf721c30",
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
    revisionDate: "2025-07-21",
    sourceUrl: "https://ultramagic.com/openfiles/Manuals04/MV04ar30.pdf",
    sourcePages: ["2.4", "5.3 à 5.5", "5.8", "5.9", "8.1", "9.1"],
    authorityStatus: "OFFICIAL_SOURCE",
    units: { altitude: "m AMSL", temperature: "°C", mass: "kg" },
    interpolationPolicy: "NOT_IMPLEMENTED",
    extrapolationAllowed: false,
    parserVersion: "1",
    sourceFingerprint: "sha256:b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab",
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
      if (dataset.id === "CAMERON_ISSUE_10_AMENDMENT_18") {
        if (!cameronZ105Official.enabled) errors.push(`${dataset.id}: activation fine Cameron Z105 absente`);
        errors.push(...auditCameronZ105ReferenceCoverage(cameronZ105References).map((error) => `${dataset.id}: ${error}`));
        if (cameronZ105Official.verification.verifiedBy.length < 2) errors.push(`${dataset.id}: double validation humaine absente`);
      }
    }
  }
  return errors;
}
