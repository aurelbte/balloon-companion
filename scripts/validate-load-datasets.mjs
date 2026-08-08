import { officialLoadDatasets, validateOfficialLoadDatasets } from "../app/lib/loadPerformance/manufacturerDatasets.ts";
import { enabledDemoLoadDatasets } from "../app/lib/loadPerformance/datasets/demoCameronZ105.ts";
import { cameronZ105Official } from "../app/lib/loadPerformance/datasets/cameronZ105Official.ts";
import { auditCameronZ105ReferenceCoverage, cameronZ105References } from "../app/lib/loadPerformance/referenceCases/cameronZ105References.ts";
import { CAMERON_Z105_REFERENCE_001 } from "../app/lib/loadPerformance/referenceCases/cameronZ105References.ts";
import { calculateOfficialLoad } from "../app/lib/loadPerformance/engine.ts";
import { enabledPilotValidationLoadConfigurations } from "../app/lib/loadPerformance/modelParameters/activationRegistry.ts";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const loadPerformanceRoot = fileURLToPath(new URL("../app/lib/loadPerformance/", import.meta.url));
const forbiddenArchitectureTerms = ["temperature" + "Profile", "limiting" + "TemperatureC", "Load" + "WeatherProvider"];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const errors = validateOfficialLoadDatasets(officialLoadDatasets);
if (enabledPilotValidationLoadConfigurations.length !== 28) errors.push("Validation pilote : les 28 configurations Cameron tracées doivent être candidates");
const pilotConfiguration = enabledPilotValidationLoadConfigurations.find(({ modelParameterSetId }) => modelParameterSetId === "CAMERON_Z105");
if (pilotConfiguration?.manufacturerMethodId !== "CAMERON_METHOD_A2" || pilotConfiguration?.modelParameterSetId !== "CAMERON_Z105" || pilotConfiguration?.manualRevision !== "ISSUE_10_AMENDMENT_18") errors.push("Validation pilote : identité Cameron Z105 invalide");
const reference = CAMERON_Z105_REFERENCE_001;
const referenceInput = {
  balloonId: reference.id,
  manufacturer: reference.manufacturer,
  model: reference.model,
  volumeM3: reference.volumeM3,
  applicableMtowKg: reference.applicableMtowKg,
  configurationLimitsConfirmed: true,
  balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg,
  occupantsWeightKg: reference.occupantsWeightKg,
  launchElevationMslM: reference.launchElevationMslM,
  plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
  groundTemperature: { temperatureC: reference.groundTemperatureC, sourceModel: "REFERENCE", forecastRun: reference.verifiedAt, validTime: reference.verifiedAt },
};
const candidateReference = calculateOfficialLoad(referenceInput);
if (candidateReference.status !== "AVAILABLE") errors.push(`Validation pilote : REFERENCE_001 indisponible (${candidateReference.reasonCode})`);
if (candidateReference.status === "AVAILABLE") {
  if (candidateReference.calculationStatus !== "CANDIDATE_PILOT_VALIDATION") errors.push("Validation pilote : statut candidat absent");
  if (candidateReference.manufacturerMethodId !== "CAMERON_METHOD_A2") errors.push("Validation pilote : méthode constructeur absente");
  if (candidateReference.datasetId.includes("DEMO") || "calculationMode" in candidateReference) errors.push("Validation pilote : dataset DEMO interdit");
  if (Math.floor(candidateReference.marginKg) !== 80) errors.push("Validation pilote : REFERENCE_001 ne produit plus +80 kg");
}
const unconfirmedReference = calculateOfficialLoad({ ...referenceInput, configurationLimitsConfirmed: false });
if (unconfirmedReference.status !== "UNAVAILABLE" || unconfirmedReference.reasonCode !== "CONFIGURATION_LIMITS_UNCONFIRMED") errors.push("Validation pilote : une configuration non confirmée produit un résultat");
const ambiguousModel = calculateOfficialLoad({ ...referenceInput, model: "Z425", volumeM3: 12_036 });
if (ambiguousModel.status !== "UNAVAILABLE" || ambiguousModel.reasonCode !== "UNSUPPORTED_MODEL") errors.push("Validation pilote : une désignation ambiguë produit un résultat");
if (cameronZ105Official.enabled) {
  if (!cameronZ105Official.documentedData.loadTable) errors.push("CAMERON_Z105_OFFICIAL: table officielle absente");
  if (!cameronZ105Official.source.manualRevision || cameronZ105Official.source.tablePages.length === 0) errors.push("CAMERON_Z105_OFFICIAL: source ou pages exactes absentes");
  if (!cameronZ105Official.calculationMethod.interpolationPolicy) errors.push("CAMERON_Z105_OFFICIAL: méthode d’interpolation absente");
  errors.push(...auditCameronZ105ReferenceCoverage(cameronZ105References).map((error) => `CAMERON_Z105_OFFICIAL: ${error}`));
}
for (const dataset of enabledDemoLoadDatasets) {
  if (dataset.official !== false) errors.push(`${dataset.id}: un dataset DEMO ne peut jamais être officiel`);
  if (dataset.authorityStatus !== "DEMO_ONLY") errors.push(`${dataset.id}: statut DEMO_ONLY requis`);
  if (officialLoadDatasets.some(({ id }) => id === dataset.id)) errors.push(`${dataset.id}: dataset DEMO présent dans la liste officielle`);
  if (dataset.sourceUrl !== null || dataset.manualRevision !== null || dataset.verifiedBy !== null) errors.push(`${dataset.id}: une source constructeur ne doit pas être revendiquée`);
  if (dataset.extrapolationAllowed !== false) errors.push(`${dataset.id}: extrapolation DEMO interdite`);
}
for (const file of sourceFiles(loadPerformanceRoot)) {
  const source = readFileSync(file, "utf8");
  for (const term of forbiddenArchitectureTerms) {
    if (source.includes(term)) errors.push(`${file}: terme d’architecture interdit détecté (${term})`);
  }
}
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${officialLoadDatasets.length} datasets audités, ${officialLoadDatasets.filter(({ enabled }) => enabled).length} activé(s).`);
}
