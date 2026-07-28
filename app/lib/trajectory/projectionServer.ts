import { projectTrajectory } from "./engine.ts";
import {
  trajectoryErrorMessage,
  validateTrajectoryProjectionRequest,
  type TrajectoryProjectionApiResponse,
  type TrajectoryProjectionRequest,
} from "./integration.ts";
import {
  TrajectoryDomainError,
  type WindProvider,
} from "./types.ts";

export type ProjectionServerDependencies = {
  getTerrainAltitude(
    latitude: number,
    longitude: number,
  ): Promise<number>;
  createWindProvider(terrainAltitudeAmslM?: number): WindProvider;
};

export type ProjectionServerResult = {
  status: number;
  body: TrajectoryProjectionApiResponse;
};

function statusForDomainError(error: TrajectoryDomainError): number {
  if (
    [
      "INVALID_COORDINATES",
      "INVALID_DATE",
      "INVALID_DURATION",
      "INVALID_TARGET_ALTITUDE",
      "INVALID_CLIMB_RATE",
      "INVALID_DESCENT_RATE",
      "UNSUPPORTED_WEATHER_MODEL",
    ].includes(error.code)
  ) {
    return 400;
  }
  if (
    [
      "TARGET_BELOW_TERRAIN",
      "TERRAIN_ALTITUDE_REQUIRED",
      "INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE",
      "ALTITUDE_NOT_BRACKETED",
      "TIME_NOT_BRACKETED",
      "INVALID_WIND",
      "VERTICAL_PROFILE_OUT_OF_BOUNDS",
    ].includes(error.code)
  ) {
    return 422;
  }
  return 503;
}

export async function orchestrateTrajectoryProjection(
  rawRequest: unknown,
  dependencies: ProjectionServerDependencies,
): Promise<ProjectionServerResult> {
  let request: TrajectoryProjectionRequest;
  try {
    request = validateTrajectoryProjectionRequest(rawRequest);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_REQUEST";
    return {
      status: 400,
      body: {
        ok: false,
        error: { code, message: "La demande de projection est invalide." },
      },
    };
  }

  let terrainAltitudeAmslM: number | undefined;
  try {
    const elevation = await dependencies.getTerrainAltitude(
      request.launchSite.latitude,
      request.launchSite.longitude,
    );
    if (!Number.isFinite(elevation) || elevation < -500 || elevation > 9_000) {
      throw new Error("invalid elevation");
    }
    terrainAltitudeAmslM = elevation;
  } catch {
    if (
      request.climbRateMps !== undefined ||
      request.descentRateMps !== undefined
    ) {
      return {
        status: 503,
        body: {
          ok: false,
          error: {
            code: "TERRAIN_ALTITUDE_REQUIRED",
            message: trajectoryErrorMessage("TERRAIN_ALTITUDE_REQUIRED"),
          },
        },
      };
    }
  }

  const launchSite = {
    ...request.launchSite,
    ...(terrainAltitudeAmslM === undefined
      ? {}
      : { terrainAltitudeAmslM }),
  };
  try {
    const projection = await projectTrajectory(
      {
        start: launchSite,
        departureTime: request.launchDateTimeIso,
        durationSeconds: request.durationSeconds,
        weatherModel: request.weatherModel,
        targetAltitudeAmslM: request.targetAltitudeAmslM,
        ...(request.climbRateMps === undefined
          ? {}
          : { climbRateMps: request.climbRateMps }),
        ...(request.descentRateMps === undefined
          ? {}
          : { descentRateMps: request.descentRateMps }),
      },
      dependencies.createWindProvider(terrainAltitudeAmslM),
    );
    return {
      status: 200,
      body: {
        ok: true,
        projection,
        metadata: {
          ...(terrainAltitudeAmslM === undefined
            ? {}
            : { terrainAltitudeAmslM }),
          weatherModel: request.weatherModel,
          launchSite,
        },
      },
    };
  } catch (error) {
    if (error instanceof TrajectoryDomainError) {
      return {
        status: statusForDomainError(error),
        body: {
          ok: false,
          error: {
            code: error.code,
            message: trajectoryErrorMessage(error.code),
            details: error.details,
          },
        },
      };
    }
    return {
      status: 500,
      body: {
        ok: false,
        error: {
          code: "UNEXPECTED_ERROR",
          message: "La projection n’a pas pu être calculée.",
        },
      },
    };
  }
}
