import type { LoadCalculationInput, LoadCalculationResult, LoadUnavailableReasonCode } from "../types.ts";
import type { LoadModelParameterSet } from "../modelParameters/types.ts";
import loadingChartAudit from "../datasets/audits/kubicek-b3102-ed3-rev19-loading-chart.json" with { type: "json" };

export const KUBICEK_LOADING_TABLE_MIN_LU = 10;
export const KUBICEK_LOADING_TABLE_MAX_LU = 23;
const METERS_PER_FOOT = 0.3048;
const CONDITIONS_OUTSIDE_METHOD_DOMAIN = "CONDITIONS_OUTSIDE_METHOD_DOMAIN" as LoadUnavailableReasonCode;

const rows: Readonly<Record<string, readonly number[]>> = {
  BB9: [145,160,175,189,204,218,233,247,262,276,291,295,295,295], BB9E: [145,160,175,189,204,218,233,247,262,276,291,295,295,295], BB9EF: [145,160,175,189,204,218,233,247,262,276,291,295,295,295],
  BB12: [194,213,233,252,271,291,310,330,349,368,385,385,385,385], BB12E: [194,213,233,252,271,291,310,330,349,368,385,385,385,385], BB12EF: [194,213,233,252,271,291,310,330,349,368,385,385,385,385],
  BB14XR: [226,249,271,294,317,339,362,385,407,420,420,420,420,420],
  BB16: [259,284,310,336,362,388,414,439,465,470,470,470,470,470], BB16E: [259,284,310,336,362,388,414,439,465,470,470,470,470,470], BB16EF: [259,284,310,336,362,388,414,439,465,470,470,470,470,470], BB16XR: [259,284,310,336,362,388,414,439,465,470,470,470,470,470],
  BB17GP: [272,299,326,354,381,408,435,462,490,495,495,495,495,495], BB17XR: [272,299,326,354,381,408,435,462,490,495,495,495,495,495],
  BB18E: [291,320,349,378,407,436,465,494,524,550,550,550,550,550], BB18XR: [291,320,349,378,407,436,465,494,524,553,570,570,570,570],
  BB20: [323,355,388,420,452,485,517,549,582,614,630,630,630,630], BB20E: [323,355,388,420,452,485,517,549,582,614,630,630,630,630], BB20ED: [323,355,388,420,452,485,517,549,582,614,630,630,630,630],
  BB20GP: [323,355,388,420,452,485,517,549,582,614,646,679,711,730], BB20XR: [323,355,388,420,452,485,517,549,582,614,646,679,711,730],
  BB22E: [355,391,427,462,498,533,569,604,640,675,680,680,680,680], BB22ED: [355,391,427,462,498,533,569,604,640,675,680,680,680,680], BB22M: [355,391,427,462,498,533,569,604,640,675,680,680,680,680],
  BB22: [355,391,427,462,498,533,569,604,640,675,711,730,730,730], BB22D: [355,391,427,462,498,533,569,604,640,675,711,730,730,730], BB22N: [355,391,427,462,498,533,569,604,640,675,711,730,730,730], BB22Z: [355,391,427,462,498,533,569,604,640,675,711,730,730,730],
  BB22XR: [355,391,427,462,498,533,569,604,640,675,711,747,780,780],
  BB26E: [420,462,504,546,588,630,672,714,730,730,730,730,730,730], BB26ED: [420,462,504,546,588,630,672,714,730,730,730,730,730,730], BB26M: [420,462,504,546,588,630,672,714,730,730,730,730,730,730],
  BB26: [420,462,504,546,588,630,672,714,756,798,840,840,840,840], BB26D: [420,462,504,546,588,630,672,714,756,798,840,840,840,840], BB26N: [420,462,504,546,588,630,672,714,756,798,840,840,840,840], BB26Z: [420,462,504,546,588,630,672,714,756,798,840,840,840,840], BB26XR: [420,462,504,546,588,630,672,714,756,798,840,840,840,840],
  BB30E: [485,533,582,630,679,727,776,824,840,840,840,840,840,840], BB30ED: [485,533,582,630,679,727,776,824,840,840,840,840,840,840], BB30M: [485,533,582,630,679,727,776,824,840,840,840,840,840,840],
  BB30D: [485,533,582,630,679,727,776,824,873,921,945,945,945,945], BB30N: [485,533,582,630,679,727,776,824,873,921,945,945,945,945], BB30Z: [485,533,582,630,679,727,776,824,873,921,945,945,945,945], BB30XR: [485,533,582,630,679,727,776,824,873,921,945,945,945,945],
  BB34E: [549,604,659,714,769,824,879,934,945,945,945,945,945,945], BB34ED: [549,604,659,714,769,824,879,934,945,945,945,945,945,945],
  BB34D: [549,604,659,714,769,824,879,934,989,1040,1040,1040,1040,1040], BB34Z: [549,604,659,714,769,824,879,934,989,1040,1040,1040,1040,1040],
  BB37D: [598,658,717,777,837,897,957,1016,1076,1136,1150,1150,1150,1150], BB37N: [598,658,717,777,837,897,957,1016,1076,1136,1150,1150,1150,1150], BB37Z: [598,658,717,777,837,897,957,1016,1076,1136,1150,1150,1150,1150],
  BB40D: [646,711,776,840,905,969,1034,1099,1163,1228,1293,1310,1310,1310], BB40Z: [646,711,776,840,905,969,1034,1099,1163,1228,1293,1310,1310,1310],
  BB42D: [687,755,824,893,961,1030,1099,1167,1236,1305,1373,1410,1410,1410], BB42Z: [687,755,824,893,961,1030,1099,1167,1236,1305,1373,1410,1410,1410],
  BB45D: [727,800,873,945,1018,1091,1163,1236,1309,1382,1454,1520,1520,1520], BB45N: [727,800,873,945,1018,1091,1163,1236,1309,1382,1454,1520,1520,1520], BB45Z: [727,800,873,945,1018,1091,1163,1236,1309,1382,1454,1520,1520,1520],
  BB51D: [824,906,989,1071,1154,1236,1318,1401,1483,1566,1648,1690,1690,1690], BB51Z: [824,906,989,1071,1154,1236,1318,1401,1483,1566,1648,1690,1690,1690],
  BB60D: [969,1066,1163,1260,1357,1454,1551,1648,1745,1842,1939,1940,1940,1940], BB60N: [969,1066,1163,1260,1357,1454,1551,1648,1745,1842,1939,1940,1940,1940], BB60Z: [969,1066,1163,1260,1357,1454,1551,1648,1745,1842,1939,1940,1940,1940],
  BB64Z: [1034,1138,1241,1344,1448,1551,1655,1758,1861,1965,2068,2100,2100,2100],
  BB70D: [1131,1244,1357,1470,1583,1697,1810,1923,2036,2149,2262,2300,2300,2300], BB70Z: [1131,1244,1357,1470,1583,1697,1810,1923,2036,2149,2262,2300,2300,2300],
  BB78Z: [1260,1386,1512,1638,1764,1890,2017,2143,2269,2395,2521,2600,2600,2600],
  BB85D: [1373,1511,1648,1785,1923,2060,2197,2335,2472,2610,2747,2820,2820,2820], BB85Z: [1373,1511,1648,1785,1923,2060,2197,2335,2472,2610,2747,2820,2820,2820],
  BB92Z: [1487,1635,1784,1933,2081,2230,2378,2527,2676,2824,2973,3000,3000,3000],
  BB100D: [1603,1763,1924,2084,2244,2405,2565,2725,2886,3046,3200,3200,3200,3200], BB100Z: [1603,1763,1924,2084,2244,2405,2565,2725,2886,3046,3200,3200,3200,3200],
  BB105P: [1697,1866,2036,2206,2375,2545,2715,2884,3054,3224,3393,3500,3500,3500],
  BB106P: [1713,1884,2055,2227,2398,2569,2740,2912,3083,3254,3426,3500,3500,3500],
  BB113P: [1826,2008,2191,2374,2556,2739,2921,3104,3287,3469,3600,3600,3600,3600],
  BB120P: [1939,2133,2327,2521,2715,2908,3102,3296,3490,3684,3700,3700,3700,3700],
  BB130P: [2101,2311,2521,2731,2941,3151,3361,3571,3781,3991,4200,4200,4200,4200],
  BB142P: [2276,2504,2732,2959,3187,3415,3642,3870,4098,4325,4500,4500,4500,4500],
  BB150P: [2405,2645,2886,3126,3367,3607,3847,4088,4328,4569,4800,4800,4800,4800],
  BB184P: [2950,3245,3540,3835,4130,4425,4720,5015,5095,5095,5095,5095,5095,5095],
};

type KubicekLoadingChartPoint = Readonly<{
  altitudeMslFt: number;
  temperatureC: number;
  liftUnits: number;
}>;

const kubicekLoadingChartPoints = loadingChartAudit.points as readonly KubicekLoadingChartPoint[];
const kubicekLoadingChartAltitudesFt = Object.freeze(
  [...new Set(kubicekLoadingChartPoints.map((point) => point.altitudeMslFt))].sort((a, b) => a - b),
);

function lookupKubicekCurveAtTemperature(altitudeMslFt: number, temperatureC: number): number | null {
  const lowerTemperatureC = Math.floor(temperatureC);
  const upperTemperatureC = Math.ceil(temperatureC);
  const lower = kubicekLoadingChartPoints.find(
    (point) => point.altitudeMslFt === altitudeMslFt && point.temperatureC === lowerTemperatureC,
  );
  const upper = kubicekLoadingChartPoints.find(
    (point) => point.altitudeMslFt === altitudeMslFt && point.temperatureC === upperTemperatureC,
  );
  if (!lower || !upper) return null;
  if (lowerTemperatureC === upperTemperatureC) return lower.liftUnits;
  return lower.liftUnits + (upper.liftUnits - lower.liftUnits) * (temperatureC - lowerTemperatureC);
}

/**
 * Interpolation dans les seules courbes vectorielles de B.3102 Ed.3 Rev.19 p.5-3.
 * L'altitude est exprimée en mètres AMSL. `null` interdit toute extrapolation hors
 * des courbes, des températures et de l'intervalle 10–23 LU imprimés.
 */
export function lookupKubicekLiftUnits(altitudeMsl: number, temperatureAtAltitudeC: number): number | null {
  if (!Number.isFinite(altitudeMsl) || !Number.isFinite(temperatureAtAltitudeC)) return null;
  const altitudeMslFt = altitudeMsl / METERS_PER_FOOT;
  const lowerAltitudeFt = [...kubicekLoadingChartAltitudesFt].reverse().find((altitude) => altitude <= altitudeMslFt);
  const upperAltitudeFt = kubicekLoadingChartAltitudesFt.find((altitude) => altitude >= altitudeMslFt);
  if (lowerAltitudeFt === undefined || upperAltitudeFt === undefined) return null;
  const lowerLiftUnits = lookupKubicekCurveAtTemperature(lowerAltitudeFt, temperatureAtAltitudeC);
  const upperLiftUnits = lookupKubicekCurveAtTemperature(upperAltitudeFt, temperatureAtAltitudeC);
  if (lowerLiftUnits === null || upperLiftUnits === null) return null;
  if (lowerAltitudeFt === upperAltitudeFt) return lowerLiftUnits;
  return lowerLiftUnits + (upperLiftUnits - lowerLiftUnits)
    * ((altitudeMslFt - lowerAltitudeFt) / (upperAltitudeFt - lowerAltitudeFt));
}

export function calculateTemperatureAtMaximumAltitudeC(input: {
  groundTemperatureC: number;
  launchElevationMslM: number;
  plannedMaximumAltitudeMslM: number;
}): number | null {
  const heightM = input.plannedMaximumAltitudeMslM - input.launchElevationMslM;
  if (![input.groundTemperatureC, input.launchElevationMslM, input.plannedMaximumAltitudeMslM].every(Number.isFinite) || heightM < 0) return null;
  return input.groundTemperatureC - 0.0065 * heightM;
}

export function interpolateKubicekLoadingTable(model: string, liftUnits: number): number | null {
  const row = rows[model];
  if (!row || !Number.isFinite(liftUnits) || liftUnits < KUBICEK_LOADING_TABLE_MIN_LU || liftUnits > KUBICEK_LOADING_TABLE_MAX_LU) return null;
  const lower = Math.floor(liftUnits);
  const upper = Math.ceil(liftUnits);
  const lowerValue = row[lower - KUBICEK_LOADING_TABLE_MIN_LU];
  const upperValue = row[upper - KUBICEK_LOADING_TABLE_MIN_LU];
  if (lowerValue === undefined || upperValue === undefined) return null;
  return lowerValue + (upperValue - lowerValue) * (liftUnits - lower);
}

export function calculateKubicekMassFromLiftUnits(
  input: LoadCalculationInput,
  modelParameters: LoadModelParameterSet,
  liftUnits: number,
) {
  const performanceLimitedMassKg = interpolateKubicekLoadingTable(modelParameters.model, liftUnits);
  const applicableMtowKg = input.applicableMtowKg;
  const equipment = input.balloonEquipmentWeightKg;
  const occupants = input.occupantsWeightKg;
  if (performanceLimitedMassKg === null || ![applicableMtowKg, equipment, occupants].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const permittedTotalMassKg = Math.min(performanceLimitedMassKg, applicableMtowKg!);
  const actualTotalMassKg = equipment! + occupants!;
  return {
    performanceLimitedMassKg,
    permittedTotalMassKg,
    actualTotalMassKg,
    availableOccupantsCapacityKg: permittedTotalMassKg - equipment!,
    marginKg: permittedTotalMassKg - actualTotalMassKg,
    limitingRule: applicableMtowKg! < performanceLimitedMassKg ? "APPLICABLE_MTOW" : "KUBICEK_LOADING_TABLE",
  } as const;
}

export function calculateKubicekLoadCandidate(
  input: LoadCalculationInput,
  modelParameters: LoadModelParameterSet,
): LoadCalculationResult {
  const groundTemperatureC = input.groundTemperature?.temperatureC;
  const launchElevationMslM = input.launchElevationMslM;
  const maximumAltitudeMslM = input.plannedMaximumAltitudeMslM;
  if (groundTemperatureC === undefined) return { status: "UNAVAILABLE", reasonCode: "NO_GROUND_TEMPERATURE", message: "Température au sol manquante." };
  if (launchElevationMslM === undefined) return { status: "UNAVAILABLE", reasonCode: "NO_LAUNCH_ELEVATION", message: "Altitude de départ manquante." };
  if (maximumAltitudeMslM === undefined) return { status: "UNAVAILABLE", reasonCode: "NO_MAXIMUM_ALTITUDE", message: "Altitude maximale manquante." };
  const temperatureAtMaxAltitudeC = calculateTemperatureAtMaximumAltitudeC({
    groundTemperatureC,
    launchElevationMslM,
    plannedMaximumAltitudeMslM: maximumAltitudeMslM,
  });
  const liftUnits = temperatureAtMaxAltitudeC === null
    ? null
    : lookupKubicekLiftUnits(maximumAltitudeMslM, temperatureAtMaxAltitudeC);
  if (liftUnits === null) {
    return {
      status: "UNAVAILABLE",
      reasonCode: CONDITIONS_OUTSIDE_METHOD_DOMAIN,
      message: "Altitude ou température hors du domaine officiel du Loading Chart Kubíček.",
    };
  }
  const mass = calculateKubicekMassFromLiftUnits(input, modelParameters, liftUnits);
  if (!mass) {
    return {
      status: "UNAVAILABLE",
      reasonCode: CONDITIONS_OUTSIDE_METHOD_DOMAIN,
      message: "Données de masse incomplètes ou Lift Units hors de la Loading Table Kubíček.",
    };
  }
  return {
    status: "AVAILABLE",
    calculationStatus: "CANDIDATE_PILOT_VALIDATION",
    ...mass,
    manufacturerMethodId: modelParameters.manufacturerMethodId,
    modelParameterSetId: modelParameters.id,
    manufacturer: "Kubíček",
    model: modelParameters.model,
    datasetId: "KUBICEK_B3102_ED3_REV19_LOADING_CHART_VECTOR",
    manualRevision: modelParameters.source.manualRevision,
    launchElevationMslM,
    maximumAltitudeMslM,
    limitingAltitudeMslM: maximumAltitudeMslM,
    groundTemperatureC,
    groundTemperatureSource: input.groundTemperature?.provider ?? input.groundTemperature?.sourceModel ?? "UNKNOWN",
    manufacturerTemperatureMethod: "B3102_STANDARD_TEMPERATURE_DECREASE",
    calculatedAt: new Date().toISOString(),
  };
}
