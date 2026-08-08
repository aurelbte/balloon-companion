import type { LoadModelParameterSet } from "./types.ts";

export const CAMERON_METHOD_A2_ID = "CAMERON_METHOD_A2";
export const CAMERON_ISSUE_10_A18_REVISION = "ISSUE_10_AMENDMENT_18";

type CameronVerificationStatus = "CANDIDATE_PILOT_VALIDATION" | "PENDING_VERIFICATION";

function cameronModel(
  model: string,
  size: string,
  volumeM3: number,
  standardMtomKg: number,
  reducedMtomKg: number | undefined,
  page: "2-6" | "2-7",
  verificationStatus: CameronVerificationStatus = "CANDIDATE_PILOT_VALIDATION",
): LoadModelParameterSet {
  return Object.freeze({
    id: model === "Z-105" ? "CAMERON_Z105" : `CAMERON_${model.replaceAll("-", "_")}`,
    manufacturer: "Cameron",
    manufacturerModelId: model,
    model,
    manufacturerMethodId: CAMERON_METHOD_A2_ID,
    volumeM3,
    standardMtomKg,
    ...(reducedMtomKg === undefined ? {} : { reducedMtomKg }),
    maximumCalculationTemperatureC: 100,
    tableRowId: `CAMERON_SIZE_${size}`,
    source: {
      manualId: "CAMERON_ISSUE_10_AMENDMENT_18",
      manualRevision: CAMERON_ISSUE_10_A18_REVISION,
      pages: [page, "9-3"],
    },
    verificationStatus,
    notes: [
      "Volume et limites de masse issus de la Table 2 du manuel Cameron.",
      "La configuration et la MTOM applicables à l'aéronef réel restent à confirmer.",
    ],
  });
}

/** Modèles Z standards explicitement désignés en Table 5 et documentés en Table 2. */
export const cameronModelParameters = Object.freeze([
  cameronModel("Z-90", "90", 2_549, 816, 499, "2-6"),
  cameronModel("Z-105", "105", 2_974, 952, 952, "2-6", "CANDIDATE_PILOT_VALIDATION"),
  cameronModel("Z-120", "120", 3_398, 1_088, 999, "2-6"),
  cameronModel("Z-133", "133", 3_767, 1_206, 999, "2-6"),
  cameronModel("Z-140", "140", 3_965, 1_270, 999, "2-6"),
  cameronModel("Z-145", "145", 4_106, 1_315, 999, "2-6"),
  cameronModel("Z-150", "150", 4_248, 1_361, 999, "2-6"),
  cameronModel("Z-160", "160", 4_531, 1_451, 999, "2-6"),
  cameronModel("Z-180", "180", 5_098, 1_633, 999, "2-6"),
  cameronModel("Z-210", "210", 5_947, 1_905, 999, "2-6"),
  cameronModel("Z-225", "225", 6_372, 2_041, 1_999, "2-6"),
  cameronModel("Z-250", "250", 7_080, 2_268, 1_999, "2-7"),
  cameronModel("Z-275", "275", 7_788, 2_494, 1_999, "2-7"),
  cameronModel("Z-315", "315", 8_920, 2_857, 2_699, "2-7"),
  cameronModel("Z-340HL", "340HL", 9_629, 3_084, 2_699, "2-7"),
  cameronModel("Z-350", "350", 9_912, 3_175, 2_699, "2-7"),
  cameronModel("Z-370", "370", 10_479, 3_357, 2_699, "2-7"),
  cameronModel("Z-375", "375", 10_620, 3_401, 2_699, "2-7"),
  cameronModel("Z-400", "400", 11_328, 3_628, 2_699, "2-7"),
  cameronModel("Z-420LW", "420LW", 11_895, 3_662, 2_699, "2-7"),
  cameronModel("Z-425LW", "425LW", 12_036, 3_662, 2_699, "2-7"),
  cameronModel("Z-450", "450", 12_744, 4_082, 2_699, "2-7"),
  cameronModel("Z-450S", "450S", 12_744, 4_082, 2_699, "2-7"),
  cameronModel("Z-500", "500", 14_160, 4_536, 2_699, "2-7"),
  cameronModel("Z-550", "550", 15_574, 4_990, 2_699, "2-7"),
  cameronModel("Z-600", "600", 16_992, 5_089, 5_089, "2-7"),
  cameronModel("Z-650", "650", 18_406, 5_089, 5_089, "2-7"),
  cameronModel("Z-750", "750", 21_238, 5_103, 5_103, "2-7"),
] satisfies readonly LoadModelParameterSet[]);

function normalizeModel(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function resolveCameronModelParameters(model: string): LoadModelParameterSet | null {
  const normalized = normalizeModel(model);
  return cameronModelParameters.find((entry) => normalizeModel(entry.model) === normalized) ?? null;
}

export function auditCameronModelParameters(
  parameters: readonly LoadModelParameterSet[] = cameronModelParameters,
): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const designations = new Set<string>();
  for (const entry of parameters) {
    const designation = normalizeModel(entry.model);
    if (ids.has(entry.id)) errors.push(`${entry.id}: identifiant dupliqué`);
    if (!designation || designations.has(designation)) errors.push(`${entry.id}: désignation ambiguë`);
    if (!(typeof entry.volumeM3 === "number" && Number.isFinite(entry.volumeM3) && entry.volumeM3 > 0)) errors.push(`${entry.id}: volume invalide`);
    if (!(typeof entry.standardMtomKg === "number" && Number.isFinite(entry.standardMtomKg) && entry.standardMtomKg > 0)) errors.push(`${entry.id}: Standard MTOM absente`);
    if (entry.reducedMtomKg !== undefined && entry.reducedMtomKg > (entry.standardMtomKg ?? 0)) errors.push(`${entry.id}: Reduced MTOM supérieure à Standard MTOM`);
    if (!entry.source.manualId || !entry.source.manualRevision || entry.source.pages.length === 0) errors.push(`${entry.id}: source ou page absente`);
    ids.add(entry.id);
    designations.add(designation);
  }
  return errors;
}

export type CameronTraceabilityAuditRow = Readonly<{
  model: string;
  parameters: "CONFIRMED" | "INCOMPLETE";
  a2Applicable: boolean;
  source: string;
  status: CameronVerificationStatus;
}>;

export function buildCameronTraceabilityAudit(): readonly CameronTraceabilityAuditRow[] {
  return cameronModelParameters.map((entry) => ({
    model: entry.model,
    parameters: typeof entry.volumeM3 === "number"
      && typeof entry.standardMtomKg === "number"
      && (entry.reducedMtomKg === undefined || entry.reducedMtomKg <= entry.standardMtomKg)
      ? "CONFIRMED"
      : "INCOMPLETE",
    a2Applicable: entry.manufacturerMethodId === CAMERON_METHOD_A2_ID,
    source: `${entry.source.manualId} | ${entry.source.pages.join(", ")}`,
    status: entry.verificationStatus as CameronVerificationStatus,
  }));
}

export const cameronZ105Parameters = resolveCameronModelParameters("Z-105")!;
