import { readManualAudit } from "./shared.mjs";
import { cameronZ105Official } from "../../app/lib/loadPerformance/datasets/cameronZ105Official.ts";
import { CAMERON_Z105_REFERENCE_001, auditCameronZ105ReferenceCoverage } from "../../app/lib/loadPerformance/referenceCases/cameronZ105References.ts";
import { calculateCameronOfficialCandidate } from "../../app/lib/loadPerformance/cameron/officialCalculation.ts";

const audit = await readManualAudit();
const errors = [];
for (const document of audit.documents) {
  if (!/^[a-f0-9]{64}$/.test(document.checksumSha256)) errors.push(`${document.id}: checksum SHA-256 invalide`);
  if (!document.sourceUrl.startsWith("https://")) errors.push(`${document.id}: URL officielle HTTPS requise`);
  if (!document.revision || !document.revisionDate || !document.retrievedAt) errors.push(`${document.id}: métadonnées documentaires incomplètes`);
}
const reference = CAMERON_Z105_REFERENCE_001;
const candidate = calculateCameronOfficialCandidate({
  balloonId: "REFERENCE_001", manufacturer: reference.manufacturer, model: reference.model,
  volumeM3: reference.volumeM3, applicableMtowKg: reference.applicableMtowKg,
  balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg, occupantsWeightKg: reference.occupantsWeightKg,
  launchElevationMslM: reference.launchElevationMslM, plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
  groundTemperature: { temperatureC: reference.groundTemperatureC, sourceModel: "REFERENCE", forecastRun: reference.verifiedAt, validTime: reference.verifiedAt },
});
if (!candidate || Math.floor(candidate.marginKg) !== reference.expectedMarginKg) errors.push("CAMERON_Z105_REFERENCE_001: le candidat officiel ne reproduit pas +80 kg");
if (cameronZ105Official.enabled) {
  errors.push(...auditCameronZ105ReferenceCoverage([reference]));
  if (String(cameronZ105Official.verification?.status) !== "HUMAN_VERIFIED") errors.push("CAMERON_Z105_OFFICIAL: double validation humaine absente");
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`${audit.documents.length} documents vérifiés ; Cameron Z105 reste ${cameronZ105Official.authorityStatus}.`);
