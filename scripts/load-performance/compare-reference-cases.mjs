import { calculateCameronOfficialCandidate } from "../../app/lib/loadPerformance/cameron/officialCalculation.ts";
import { cameronZ105Official } from "../../app/lib/loadPerformance/datasets/cameronZ105Official.ts";
import { auditCameronZ105ReferenceCoverage, cameronZ105References } from "../../app/lib/loadPerformance/referenceCases/cameronZ105References.ts";

const rows = cameronZ105References.map((reference) => {
  const result = calculateCameronOfficialCandidate({
    balloonId: reference.id, manufacturer: reference.manufacturer, model: reference.model,
    volumeM3: reference.volumeM3, applicableMtowKg: reference.applicableMtowKg,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg, occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM, plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { temperatureC: reference.groundTemperatureC, sourceModel: "REFERENCE", forecastRun: reference.verifiedAt, validTime: reference.verifiedAt },
  });
  const actual = result ? Math.floor(result.marginKg) : null;
  return {
    Fabricant: reference.manufacturer,
    Modèle: reference.model,
    Référence: reference.id,
    Attendu: `${reference.expectedMarginKg >= 0 ? "+" : ""}${reference.expectedMarginKg} kg`,
    Moteur: actual === null ? "INDISPONIBLE" : `${actual >= 0 ? "+" : ""}${actual} kg`,
    Écart: actual === null ? "—" : `${actual - reference.expectedMarginKg} kg`,
    Statut: actual === reference.expectedMarginKg ? "PASS" : "FAIL",
  };
});
console.table(rows);
const failures = rows.filter(({ Statut }) => Statut !== "PASS");
if (cameronZ105Official.enabled) {
  failures.push(...auditCameronZ105ReferenceCoverage(cameronZ105References).map((message) => ({ Statut: "FAIL", message })));
}
if (failures.length) process.exitCode = 1;
