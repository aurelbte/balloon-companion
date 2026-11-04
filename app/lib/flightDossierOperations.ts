import type { Balloon } from "./balloons.ts";
import type { AirspaceFeatureCollection, AirspaceGeoJsonProperties } from "./openaip.ts";
import type { TrajectoryPoint } from "./trajectory/types.ts";
import { normalizeOpenAipAltitudeLimit } from "./airspaceAltitude.ts";
import { intersectPlannedAirspaceSegment } from "./trajectoryAirspaces.ts";
import { calculateOfficialLoad, displayLoadMarginKg } from "./loadPerformance/engine.ts";
import type { LoadCalculationInput, LoadCalculationResult } from "./loadPerformance/types.ts";
import { normalizeLoadIdentifier } from "./loadPerformance/candidateEngine.ts";
import { cameronModelParameters } from "./loadPerformance/modelParameters/cameronModels.ts";
import { kubicekModelParameters, KUBICEK_LIFT_UNITS_METHOD_ID } from "./loadPerformance/modelParameters/kubicekModels.ts";
import { ultramagicModelParameters } from "./loadPerformance/modelParameters/ultramagicModels.ts";
import loadingChart from "./loadPerformance/datasets/audits/kubicek-b3102-ed3-rev19-loading-chart.json" with { type: "json" };

export function prepareDossierLoad(balloon: Balloon, input: LoadCalculationInput, demoMode = false) {
  const parameters = [...cameronModelParameters, ...kubicekModelParameters, ...ultramagicModelParameters].find((item) => normalizeLoadIdentifier(item.manufacturer) === normalizeLoadIdentifier(balloon.manufacturer) && normalizeLoadIdentifier(item.model) === normalizeLoadIdentifier(balloon.model));
  const demo = demoMode || /demo|synthetic/i.test([input.officialLoadDatasetId, input.groundTemperature?.sourceModel, input.groundTemperature?.provider].filter(Boolean).join(" "));
  const mismatch = input.balloonId !== balloon.id || normalizeLoadIdentifier(input.manufacturer) !== normalizeLoadIdentifier(balloon.manufacturer) || normalizeLoadIdentifier(input.model) !== normalizeLoadIdentifier(balloon.model);
  // Never consume the UI's potentially synthetic result; call the existing engine.
  const result: LoadCalculationResult | null = demo || mismatch ? null : calculateOfficialLoad(input);
  const available = result?.status === "AVAILABLE" ? result : null;
  const knownMass = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const plannedMassKg = demo || mismatch ? null : available?.actualTotalMassKg ?? (knownMass(input.balloonEquipmentWeightKg) && knownMass(input.occupantsWeightKg) ? input.balloonEquipmentWeightKg! + input.occupantsWeightKg! : null);
  const numericMargin = available ? displayLoadMarginKg(available.marginKg) : null;
  const curve = !demo && !mismatch && parameters?.manufacturerMethodId === KUBICEK_LIFT_UNITS_METHOD_ID
    ? { status: "SOURCE_DATA_AVAILABLE" as const, source: { title: loadingChart.source, revision: loadingChart.revision, page: loadingChart.page, url: loadingChart.sourceUrl, sha256: loadingChart.sourceSha256 }, verificationStatus: parameters.verificationStatus, points: loadingChart.points, axes: loadingChart.axisBounds, units: { altitude: "ft AMSL", temperature: "°C", ordinate: "Lift Units" }, usedByCalculation: available?.datasetId === "KUBICEK_B3102_ED3_REV19_LOADING_CHART_VECTOR", notice: "Points extraits du manuel existant ; aucune courbe de masse ni limite supplémentaire calculée." }
    : { status: "UNAVAILABLE" as const, source: demo || mismatch ? null : parameters?.source ?? null, points: null, notice: "Aucune courbe numérique applicable disponible ; aucune courbe synthétique générée." };
  return {
    balloon,
    status: available ? "AVAILABLE" as const : "UNAVAILABLE" as const,
    manufacturerParameters: demo || mismatch ? null : parameters ?? null,
    calculationStatus: available?.calculationStatus ?? "UNAVAILABLE" as const,
    result,
    unavailableReason: demo ? "DEMO_DATA_EXCLUDED" : mismatch ? "BALLOON_INPUT_MISMATCH" : result?.status === "UNAVAILABLE" ? result.reasonCode : null,
    message: demo ? "Données de démonstration exclues du dossier." : mismatch ? "Les entrées de charge ne correspondent pas au ballon sélectionné." : result?.status === "UNAVAILABLE" ? result.message : null,
    plannedMassKg,
    applicableLimitKg: available?.permittedTotalMassKg ?? null,
    limitingRule: available?.limitingRule ?? null,
    marginKg: available?.marginKg ?? null,
    signedMarginKg: numericMargin === null ? null : `${numericMargin >= 0 ? "+" : "−"}${Math.abs(numericMargin)} kg`,
    plannedMaximumAltitudeMslM: input.plannedMaximumAltitudeMslM ?? null,
    curve,
  };
}

export type DossierAirspacePassage = {
  airspace: AirspaceGeoJsonProperties;
  floor: ReturnType<typeof normalizeOpenAipAltitudeLimit>;
  ceiling: ReturnType<typeof normalizeOpenAipAltitudeLimit>;
  spatialStatus: "INTERSECTS_3D" | "UNCERTAIN";
  status: "UNCERTAIN";
  passages: Array<{ entryAt: string | null; exitAt: string | null; entryAltitudeAmslM: number | null; exitAltitudeAmslM: number | null; spatialStatus: "INTERSECTS" | "UNCERTAIN"; reasons: string[] }>;
  frequencies: { source: "OPENAIP"; values: AirspaceGeoJsonProperties["frequencies"]; rawSourceAvailable: boolean; verifiedAgainstAip: false; notice: string };
  activity: { status: "UNKNOWN"; published: Pick<AirspaceGeoJsonProperties, "activity" | "onDemand" | "onRequest" | "byNotam" | "activeFrom" | "activeUntil">; notice: string };
  reasons: string[];
};

export function prepareDossierAirspaces(points: readonly TrajectoryPoint[], airspaces: AirspaceFeatureCollection) {
  const candidates = new Map<string, DossierAirspacePassage>();
  let invalidSegments = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1], current = points[index];
    const start = Date.parse(previous.timestamp), end = Date.parse(current.timestamp);
    const validTimes = Number.isFinite(start) && Number.isFinite(end) && end > start;
    if (!validTimes) invalidSegments++;
    for (const feature of airspaces.features) {
      const intervals = intersectPlannedAirspaceSegment(previous, current, feature.geometry, feature.properties);
      if (!intervals.length) continue;
      const p = feature.properties;
      const key = p.airspaceCompositeKey || p.airspaceId || p.id;
      const item = candidates.get(key) ?? {
        airspace: p,
        floor: normalizeOpenAipAltitudeLimit(p.lowerLimit), ceiling: normalizeOpenAipAltitudeLimit(p.upperLimit),
        spatialStatus: "UNCERTAIN" as const, status: "UNCERTAIN" as const, passages: [],
        frequencies: { source: "OPENAIP" as const, values: p.sourceFrequencies ?? p.frequencies, rawSourceAvailable: p.sourceFrequencies !== undefined, verifiedAgainstAip: false as const, notice: p.sourceFrequencies === undefined ? "Cache sans fréquences brutes : valeurs d’affichage susceptibles de corrections locales ; non vérifiées dans l’AIP." : "Fréquences OpenAIP brutes, non vérifiées dans l’AIP ; aucune fréquence déduite." },
        activity: { status: "UNKNOWN" as const, published: { activity: p.activity, onDemand: p.onDemand, onRequest: p.onRequest, byNotam: p.byNotam, activeFrom: p.activeFrom, activeUntil: p.activeUntil }, notice: "Les métadonnées OpenAIP ne démontrent pas l’activation aux horaires de passage. Horaires, NOTAM et activation à vérifier." },
        reasons: ["ACTIVITY_AT_PASSAGE_UNKNOWN"],
      } satisfies DossierAirspacePassage;
      for (const interval of intervals) {
        const altitude = (fraction: number) => Number.isFinite(previous.altitudeAmslM) && Number.isFinite(current.altitudeAmslM) ? previous.altitudeAmslM + (current.altitudeAmslM - previous.altitudeAmslM) * fraction : null;
        const reasons = [...interval.reasons, ...(!validTimes ? ["TRACE_TIMES_INVALID"] : [])];
        const passage: DossierAirspacePassage["passages"][number] = { entryAt: validTimes ? new Date(start + (end - start) * interval.entryFraction).toISOString() : null, exitAt: validTimes ? new Date(start + (end - start) * interval.exitFraction).toISOString() : null, entryAltitudeAmslM: altitude(interval.entryFraction), exitAltitudeAmslM: altitude(interval.exitFraction), spatialStatus: reasons.length ? "UNCERTAIN" : "INTERSECTS", reasons };
        if (!item.passages.some((existing) => JSON.stringify(existing) === JSON.stringify(passage))) item.passages.push(passage);
      }
      item.spatialStatus = item.passages.some((passage) => passage.spatialStatus === "INTERSECTS") ? "INTERSECTS_3D" : "UNCERTAIN";
      item.reasons = [...new Set([...item.reasons, ...item.passages.flatMap((passage) => passage.reasons)])];
      candidates.set(key, item);
    }
  }
  return {
    source: "OPENAIP" as const,
    coverage: "NOT_VERIFIED_FOR_ENTIRE_TRACE" as const,
    confirmed: [] as DossierAirspacePassage[],
    uncertain: [...candidates.values()].sort((a, b) => (a.passages[0]?.entryAt ?? "").localeCompare(b.passages[0]?.entryAt ?? "")),
    invalidSegments,
    notices: ["Intersections calculées sur les segments planifiés, avec évolution linéaire de position, altitude et temps entre points.", "La couverture chargée ne prouve pas l’exhaustivité du trajet : une liste vide ne signifie pas absence d’espaces.", "Aucune traversée active confirmée sans preuve d’activation ; AGL/SFC exigent le terrain local, FL une référence de pression compatible."],
  };
}

export function prepareFlightDossierOperations(
  dossier: { traceId: string; points: readonly TrajectoryPoint[]; balloon: Balloon },
  loadInput: LoadCalculationInput,
  airspaces: AirspaceFeatureCollection,
  demoMode = false,
) {
  const load = prepareDossierLoad(dossier.balloon, loadInput, demoMode);
  const traceMaximumAltitudeAmslM = Math.max(...dossier.points.map((point) => point.altitudeAmslM));
  const exceedsLoadAltitude = load.plannedMaximumAltitudeMslM !== null && traceMaximumAltitudeAmslM > load.plannedMaximumAltitudeMslM;
  return {
    traceId: dossier.traceId,
    load: exceedsLoadAltitude ? { ...load, status: "UNAVAILABLE" as const, result: null, applicableLimitKg: null, marginKg: null, signedMarginKg: null, unavailableReason: "TRACE_EXCEEDS_LOAD_ALTITUDE", message: "La trace dépasse l’altitude maximale utilisée pour le calcul de charge ; limite et marge non applicables à cette stratégie." } : load,
    traceMaximumAltitudeAmslM,
    airspaces: prepareDossierAirspaces(dossier.points, airspaces),
  };
}
export type FlightDossierOperations = ReturnType<typeof prepareFlightDossierOperations>;
