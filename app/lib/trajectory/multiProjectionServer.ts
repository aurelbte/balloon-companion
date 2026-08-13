import { projectTrajectory } from "./engine.ts";
import {
  ALTITUDE_COLORS,
  altitudeKey,
  altitudeLabel,
  trajectoryErrorMessage,
  validateMultiAltitudeProjectionRequest,
  type AltitudeOption,
  type AltitudeProjectionFailure,
  type MultiAltitudeProjectionApiResponse,
} from "./integration.ts";
import { TrajectoryDomainError, type WindProvider } from "./types.ts";
import { weatherModelByProviderId } from "../weather/models.ts";
import { FLIGHT_WIND_ALTITUDE_LEVELS } from "../flightWindProfile.ts";

export type MultiProjectionServerDependencies = {
  getTerrainAltitude(latitude: number, longitude: number): Promise<number>;
  createWindProvider(terrainAltitudeAmslM: number): WindProvider;
};

function failureFor(
  option: AltitudeOption,
  altitudeAmslM: number | undefined,
  error: unknown,
): AltitudeProjectionFailure {
  const code =
    error instanceof TrajectoryDomainError
      ? error.code
      : "UNEXPECTED_ERROR";
  const details =
    error instanceof TrajectoryDomainError ? error.details : undefined;
  const message =
    code === "WEATHER_VERTICAL_COVERAGE_INSUFFICIENT" &&
    typeof details?.lowestAvailableAmslM === "number" &&
    typeof details.highestAvailableAmslM === "number"
      ? `Colonne disponible de ${Math.round(details.lowestAvailableAmslM)} à ${Math.round(details.highestAvailableAmslM)} m AMSL.`
      : trajectoryErrorMessage(code);
  return {
    altitudeKey: altitudeKey(option),
    ...(altitudeAmslM === undefined ? {} : { altitudeAmslM }),
    code,
    message,
    ...(details ? { details } : {}),
  };
}

export async function orchestrateMultiAltitudeProjection(
  rawRequest: unknown,
  dependencies: MultiProjectionServerDependencies,
): Promise<{ status: number; body: MultiAltitudeProjectionApiResponse }> {
  let request;
  try {
    request = validateMultiAltitudeProjectionRequest(rawRequest);
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

  const model = weatherModelByProviderId(request.weatherModel);
  if (!model?.supported) {
    return {
      status: 400,
      body: {
        ok: false,
        error: {
          code: "WEATHER_MODEL_UNAVAILABLE",
          message: "Ce modèle météo n’est pas disponible.",
        },
      },
    };
  }

  let terrainAltitudeAmslM: number;
  try {
    terrainAltitudeAmslM = await dependencies.getTerrainAltitude(
      request.launchSite.latitude,
      request.launchSite.longitude,
    );
    if (
      !Number.isFinite(terrainAltitudeAmslM) ||
      terrainAltitudeAmslM < -500 ||
      terrainAltitudeAmslM > 9_000
    ) {
      throw new Error("invalid elevation");
    }
  } catch {
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

  const launchSite = {
    ...request.launchSite,
    terrainAltitudeAmslM,
  };
  let preparedProvider: WindProvider;
  try {
    const provider = dependencies.createWindProvider(terrainAltitudeAmslM);
    preparedProvider = provider.prepareProjection
      ? await provider.prepareProjection({
          latitude: launchSite.latitude,
          longitude: launchSite.longitude,
          validAt: request.launchDateTimeIso,
          altitudeAmslM: terrainAltitudeAmslM,
          weatherModel: request.weatherModel,
        })
      : provider;
  } catch (error) {
    const code =
      error instanceof TrajectoryDomainError
        ? error.code
        : "UPSTREAM_UNAVAILABLE";
    return {
      status: 503,
      body: {
        ok: false,
        error: {
          code,
          message:
            error instanceof TrajectoryDomainError
              ? error.message
              : trajectoryErrorMessage(code),
          ...(error instanceof TrajectoryDomainError && error.details
            ? { details: error.details }
            : {}),
        },
      },
    };
  }

  const layerProjections = [];
  const failures: AltitudeProjectionFailure[] = [];
  for (const option of request.altitudesAmslM) {
    const altitudeAmslM =
      option === "ground" ? terrainAltitudeAmslM : option;
    if (altitudeAmslM < terrainAltitudeAmslM) {
      failures.push({
        altitudeKey: altitudeKey(option),
        altitudeAmslM,
        code: "TARGET_BELOW_TERRAIN",
        message: "Altitude inférieure au terrain.",
        details: { terrainAltitudeAmslM },
      });
      continue;
    }
    try {
      const projection = await projectTrajectory(
        {
          start: launchSite,
          departureTime: request.launchDateTimeIso,
          durationSeconds: request.durationSeconds,
          weatherModel: request.weatherModel,
          targetAltitudeAmslM: altitudeAmslM,
        },
        preparedProvider,
      );
      layerProjections.push({
        altitudeKey: altitudeKey(option),
        altitudeAmslM,
        label: altitudeLabel(option),
        color: ALTITUDE_COLORS[altitudeKey(option)],
        projection,
      });
    } catch (error) {
      failures.push(failureFor(option, altitudeAmslM, error));
    }
  }

  let flightProfileProjection;
  if (
    request.primaryAltitudeAmslM !== undefined &&
    (request.climbRateMps !== undefined ||
      request.descentRateMps !== undefined)
  ) {
    try {
      flightProfileProjection = await projectTrajectory(
        {
          start: launchSite,
          departureTime: request.launchDateTimeIso,
          durationSeconds: request.durationSeconds,
          weatherModel: request.weatherModel,
          targetAltitudeAmslM: request.primaryAltitudeAmslM,
          ...(request.climbRateMps === undefined
            ? {}
            : { climbRateMps: request.climbRateMps }),
          ...(request.descentRateMps === undefined
            ? {}
            : { descentRateMps: request.descentRateMps }),
        },
        preparedProvider,
      );
    } catch (error) {
      failures.push({
        ...failureFor(
          request.primaryAltitudeAmslM as AltitudeOption,
          request.primaryAltitudeAmslM,
          error,
        ),
        altitudeKey: "profile",
      });
    }
  }

  const windProfile = (
    await Promise.all(
      FLIGHT_WIND_ALTITUDE_LEVELS.map(async (levelM) => {
        const altitudeAmslM = levelM === 0 ? terrainAltitudeAmslM : levelM;
        if (altitudeAmslM < terrainAltitudeAmslM) return null;
        try {
          const sample = await preparedProvider.getWind({
            latitude: launchSite.latitude,
            longitude: launchSite.longitude,
            validAt: request.launchDateTimeIso,
            altitudeAmslM,
            weatherModel: request.weatherModel,
          });
          return {
            levelM,
            altitudeAmslM,
            directionFromDeg: sample.wind.directionFromDeg,
            speedMps: sample.wind.speedMps,
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((value) => value !== null);

  if (layerProjections.length === 0) {
    return {
      status: 422,
      body: {
        ok: false,
        error: {
          code: failures[0]?.code ?? "WEATHER_COLUMN_INVALID",
          message:
            failures[0]?.message ??
            "Aucune altitude sélectionnée ne peut être projetée.",
          details: { failures },
        },
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      version: 2,
      model,
      launchSite,
      terrainAltitudeAmslM,
      launchDateTimeIso: request.launchDateTimeIso,
      durationSeconds: request.durationSeconds,
      selectedAltitudes: request.altitudesAmslM,
      ...(request.primaryAltitudeAmslM === undefined
        ? {}
        : { primaryAltitudeAmslM: request.primaryAltitudeAmslM }),
      layerProjections,
      windProfile,
      ...(flightProfileProjection ? { flightProfileProjection } : {}),
      failures,
    },
  };
}
