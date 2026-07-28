import type {
  MultiAltitudeProjectionRequest,
  StoredTrajectoryProjectionV1,
  StoredTrajectoryProjectionV2,
} from "./integration.ts";

const STORAGE_KEY = "balloon_companion_trajectory_projection";
const ANALYSIS_REQUEST_KEY = "balloon_companion_trajectory_analysis_request";

export type StoredTrajectoryAnalysisRequest = {
  version: 1;
  updatedAtIso: string;
  request: MultiAltitudeProjectionRequest;
};

function isStoredProjectionV2(
  value: unknown,
): value is StoredTrajectoryProjectionV2 {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredTrajectoryProjectionV2>;
  return (
    candidate.version === 2 &&
    typeof candidate.createdAtIso === "string" &&
    Number.isFinite(Date.parse(candidate.createdAtIso)) &&
    candidate.request?.version === 2 &&
    candidate.response?.ok === true &&
    candidate.response.version === 2 &&
    Array.isArray(candidate.response.layerProjections) &&
    candidate.response.layerProjections.some(
      (item) => Array.isArray(item.projection?.points) && item.projection.points.length > 1,
    )
  );
}

function isStoredProjectionV1(
  value: unknown,
): value is StoredTrajectoryProjectionV1 {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredTrajectoryProjectionV1>;
  return (
    candidate.version === 1 &&
    typeof candidate.createdAtIso === "string" &&
    Number.isFinite(Date.parse(candidate.createdAtIso)) &&
    candidate.response?.ok === true &&
    Array.isArray(candidate.response.projection?.points) &&
    candidate.response.projection.points.length > 0
  );
}

export function saveTrajectoryProjection(
  value: StoredTrajectoryProjectionV1 | StoredTrajectoryProjectionV2,
): boolean {
  if (
    typeof window === "undefined" ||
    (!isStoredProjectionV1(value) && !isStoredProjectionV2(value))
  )
    return false;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getTrajectoryProjection():
  | StoredTrajectoryProjectionV1
  | StoredTrajectoryProjectionV2
  | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredProjectionV1(parsed) || isStoredProjectionV2(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function getTrajectoryProjectionV2(): StoredTrajectoryProjectionV2 | null {
  const projection = getTrajectoryProjection();
  return projection?.version === 2 ? projection : null;
}

export function saveTrajectoryAnalysisRequest(
  request: MultiAltitudeProjectionRequest,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(
      ANALYSIS_REQUEST_KEY,
      JSON.stringify({
        version: 1,
        updatedAtIso: new Date().toISOString(),
        request,
      } satisfies StoredTrajectoryAnalysisRequest),
    );
    return true;
  } catch {
    return false;
  }
}

export function getTrajectoryAnalysisRequest(): StoredTrajectoryAnalysisRequest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ANALYSIS_REQUEST_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      (value as Partial<StoredTrajectoryAnalysisRequest>).version !== 1 ||
      typeof (value as Partial<StoredTrajectoryAnalysisRequest>).request !==
        "object"
    ) {
      return null;
    }
    return value as StoredTrajectoryAnalysisRequest;
  } catch {
    return null;
  }
}
