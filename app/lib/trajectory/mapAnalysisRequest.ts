import { loadPreparationDraft } from "../preparationDraftStorage.ts";
import { createTrajectoryAnalysisKey } from "./analysisState.ts";
import { getTrajectoryAnalysisRequest, type StoredTrajectoryAnalysisRequest } from "./projectionStorage.ts";

/** A persisted request is not authority for a new or edited preparation on the map. */
export function loadMapAnalysisRequest(): StoredTrajectoryAnalysisRequest | null {
  const preparation = loadPreparationDraft();
  const submitted = getTrajectoryAnalysisRequest();
  if (!submitted || !preparation?.launchSite || !preparation.departureTime || !preparation.durationMinutes) return null;
  const expected = {
    ...submitted.request,
    launchSite: preparation.launchSite,
    launchDateTimeIso: preparation.departureTime,
    durationSeconds: preparation.durationMinutes * 60,
    weatherModel: preparation.weatherModel,
    altitudesAmslM: preparation.selectedAltitudes ?? submitted.request.altitudesAmslM,
    climbRateMps: preparation.ascentRateMps,
    descentRateMps: preparation.descentRateMps,
  };
  return createTrajectoryAnalysisKey(expected, [expected.weatherModel], expected.altitudesAmslM) ===
    createTrajectoryAnalysisKey(submitted.request, [submitted.request.weatherModel], submitted.request.altitudesAmslM)
    ? submitted : null;
}
