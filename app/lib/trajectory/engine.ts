import { destinationPoint } from "../geo.ts";
import {
  TrajectoryDomainError,
  type TrajectoryPoint,
  type TrajectoryProjectionInput,
  type TrajectoryProjectionResult,
  type TrajectoryWarning,
  type TrajectoryWindUsed,
  type WindProvider,
  type WindQuery,
  type WindSample,
} from "./types.ts";
import { validateTrajectoryEngineInput } from "./validation.ts";
import { windDirectionFromToMovementDirection } from "./windMath.ts";

export const DEFAULT_TRAJECTORY_STEP_SECONDS = 20;
const FLOAT_COMPARISON_TOLERANCE = 1e-9;

type ActiveVerticalPhase = "climb" | "level" | "descent";

type ComputedVerticalProfile = {
  mode: TrajectoryProjectionResult["mode"];
  terrainAltitudeAmslM?: number;
  targetAltitudeAmslM: number;
  climbRateMps?: number;
  climbDurationSeconds?: number;
  climbEndElapsedSeconds?: number;
  descentRateMps?: number;
  descentDurationSeconds?: number;
  descentStartElapsedSeconds?: number;
  hasClimb: boolean;
  hasDescent: boolean;
};

const LAUNCH_COLUMN_WARNING: TrajectoryWarning = {
  code: "LAUNCH_COLUMN_ONLY",
  message:
    "Projection fondée sur la colonne météo du départ, sans évolution spatiale.",
};

function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

function assertValidStep(stepSeconds: number): void {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    throw new TrajectoryDomainError(
      "INVALID_STEP",
      "Le pas de projection doit être strictement positif.",
      { stepSeconds },
    );
  }
}

function computeVerticalProfile(
  input: TrajectoryProjectionInput,
): ComputedVerticalProfile {
  const wantsClimb = input.climbRateMps !== undefined;
  const wantsDescent = input.descentRateMps !== undefined;
  const terrainAltitude = input.start.terrainAltitudeAmslM;

  if ((wantsClimb || wantsDescent) && terrainAltitude === undefined) {
    throw new TrajectoryDomainError(
      "TERRAIN_ALTITUDE_REQUIRED",
      "L’altitude du terrain est nécessaire pour calculer la montée ou la descente.",
    );
  }

  if (
    terrainAltitude !== undefined &&
    (!Number.isFinite(terrainAltitude) ||
      input.targetAltitudeAmslM < terrainAltitude)
  ) {
    if (
      Number.isFinite(terrainAltitude) &&
      input.targetAltitudeAmslM < terrainAltitude
    ) {
      throw new TrajectoryDomainError(
        "TARGET_BELOW_TERRAIN",
        "L’altitude cible est inférieure à l’altitude du terrain.",
        {
          targetAltitudeAmslM: input.targetAltitudeAmslM,
          terrainAltitudeAmslM: terrainAltitude,
        },
      );
    }
    throw new TrajectoryDomainError(
      "VERTICAL_PROFILE_OUT_OF_BOUNDS",
      "L’altitude du terrain est invalide.",
      { terrainAltitudeAmslM: terrainAltitude },
    );
  }

  const altitudeDifference =
    terrainAltitude === undefined
      ? 0
      : input.targetAltitudeAmslM - terrainAltitude;
  const rawClimbDuration = wantsClimb
    ? altitudeDifference / input.climbRateMps!
    : undefined;
  const rawDescentDuration = wantsDescent
    ? altitudeDifference / input.descentRateMps!
    : undefined;
  const hasClimb =
    rawClimbDuration !== undefined &&
    rawClimbDuration > FLOAT_COMPARISON_TOLERANCE;
  const hasDescent =
    rawDescentDuration !== undefined &&
    rawDescentDuration > FLOAT_COMPARISON_TOLERANCE;
  const climbDurationSeconds = wantsClimb ? rawClimbDuration : undefined;
  const descentDurationSeconds = wantsDescent
    ? rawDescentDuration
    : undefined;
  const activeVerticalDuration =
    (hasClimb ? rawClimbDuration! : 0) +
    (hasDescent ? rawDescentDuration! : 0);

  if (
    activeVerticalDuration - input.durationSeconds >
    FLOAT_COMPARISON_TOLERANCE
  ) {
    throw new TrajectoryDomainError(
      "INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE",
      "La durée prévue est insuffisante pour effectuer la montée et la descente renseignées.",
      {
        durationSeconds: input.durationSeconds,
        climbDurationSeconds,
        descentDurationSeconds,
      },
    );
  }

  const climbEndElapsedSeconds = hasClimb
    ? rawClimbDuration
    : undefined;
  const descentStartElapsedSeconds = hasDescent
    ? input.durationSeconds - rawDescentDuration!
    : undefined;

  return {
    mode:
      hasClimb && hasDescent
        ? "climb-level-descent"
        : hasClimb
          ? "climb-then-level"
          : hasDescent
            ? "level-then-descent"
            : "constant-altitude",
    ...(terrainAltitude === undefined
      ? {}
      : { terrainAltitudeAmslM: terrainAltitude }),
    targetAltitudeAmslM: input.targetAltitudeAmslM,
    ...(wantsClimb
      ? {
          climbRateMps: input.climbRateMps,
          climbDurationSeconds,
          ...(climbEndElapsedSeconds === undefined
            ? {}
            : { climbEndElapsedSeconds }),
        }
      : {}),
    ...(wantsDescent
      ? {
          descentRateMps: input.descentRateMps,
          descentDurationSeconds,
          ...(descentStartElapsedSeconds === undefined
            ? {}
            : { descentStartElapsedSeconds }),
        }
      : {}),
    hasClimb,
    hasDescent,
  };
}

function phaseAt(
  elapsedSeconds: number,
  profile: ComputedVerticalProfile,
): ActiveVerticalPhase {
  if (
    profile.hasClimb &&
    elapsedSeconds <
      profile.climbEndElapsedSeconds! - FLOAT_COMPARISON_TOLERANCE
  ) {
    return "climb";
  }
  if (
    profile.hasDescent &&
    elapsedSeconds >=
      profile.descentStartElapsedSeconds! - FLOAT_COMPARISON_TOLERANCE
  ) {
    return "descent";
  }
  return "level";
}

function altitudeAt(
  elapsedSeconds: number,
  profile: ComputedVerticalProfile,
): number {
  const terrainAltitude = profile.terrainAltitudeAmslM;
  const phase = phaseAt(elapsedSeconds, profile);
  let altitude: number;

  if (phase === "climb") {
    altitude =
      terrainAltitude! + profile.climbRateMps! * elapsedSeconds;
  } else if (phase === "descent") {
    altitude =
      profile.targetAltitudeAmslM -
      profile.descentRateMps! *
        (elapsedSeconds - profile.descentStartElapsedSeconds!);
  } else {
    altitude = profile.targetAltitudeAmslM;
  }

  if (
    !Number.isFinite(altitude) ||
    altitude >
      profile.targetAltitudeAmslM + FLOAT_COMPARISON_TOLERANCE ||
    (terrainAltitude !== undefined &&
      altitude < terrainAltitude - FLOAT_COMPARISON_TOLERANCE)
  ) {
    throw new TrajectoryDomainError(
      "VERTICAL_PROFILE_OUT_OF_BOUNDS",
      "Le profil vertical calculé sort des altitudes prévues.",
      { elapsedSeconds, altitudeAmslM: altitude },
    );
  }

  if (
    Math.abs(altitude - profile.targetAltitudeAmslM) <=
    FLOAT_COMPARISON_TOLERANCE
  ) {
    return profile.targetAltitudeAmslM;
  }
  if (
    terrainAltitude !== undefined &&
    Math.abs(altitude - terrainAltitude) <= FLOAT_COMPARISON_TOLERANCE
  ) {
    return terrainAltitude;
  }
  return altitude;
}

function nextSegmentEnd(
  elapsedSeconds: number,
  durationSeconds: number,
  stepSeconds: number,
  profile: ComputedVerticalProfile,
): number {
  const candidates = [
    elapsedSeconds + stepSeconds,
    durationSeconds,
    profile.climbEndElapsedSeconds,
    profile.descentStartElapsedSeconds,
  ].filter(
    (candidate): candidate is number =>
      candidate !== undefined &&
      candidate >
        elapsedSeconds + FLOAT_COMPARISON_TOLERANCE,
  );
  const end = Math.min(...candidates);

  if (
    !Number.isFinite(end) ||
    end - elapsedSeconds <= FLOAT_COMPARISON_TOLERANCE
  ) {
    throw new TrajectoryDomainError(
      "VERTICAL_PROFILE_OUT_OF_BOUNDS",
      "Le découpage du profil vertical a produit un segment invalide.",
      { elapsedSeconds, endElapsedSeconds: end },
    );
  }
  return end > durationSeconds ? durationSeconds : end;
}

function assertUsableWindSample(sample: WindSample): void {
  const sourceSlicesAreUsable =
    Array.isArray(sample.sourceSlices) &&
    sample.sourceSlices.length > 0 &&
    sample.sourceSlices.every(
      (slice) =>
        Number.isFinite(slice.lowerLevel.geopotentialHeightAmslM) &&
        Number.isFinite(slice.upperLevel.geopotentialHeightAmslM) &&
        Number.isFinite(slice.verticalInterpolationRatio) &&
        slice.verticalInterpolationRatio >= 0 &&
        slice.verticalInterpolationRatio <= 1,
    );
  if (
    !Number.isFinite(sample.wind.speedMps) ||
    sample.wind.speedMps < 0 ||
    !Number.isFinite(sample.wind.directionFromDeg) ||
    !Number.isFinite(sample.sourceLatitude) ||
    !Number.isFinite(sample.sourceLongitude) ||
    !sample.sourceModel.trim() ||
    !sourceSlicesAreUsable
  ) {
    throw new TrajectoryDomainError(
      "INVALID_WIND",
      "Le vent fourni n’est pas exploitable pour la projection.",
    );
  }
}

async function prepareProjectionProvider(
  provider: WindProvider,
  query: WindQuery,
): Promise<WindProvider> {
  if (!provider.prepareProjection) return provider;
  try {
    return await provider.prepareProjection(query);
  } catch (error) {
    if (error instanceof TrajectoryDomainError) throw error;
    throw new TrajectoryDomainError(
      "UPSTREAM_UNAVAILABLE",
      "La colonne météo nécessaire à la projection est indisponible.",
      { cause: error instanceof Error ? error.name : "UnknownError" },
    );
  }
}

function compactWindTrace(sample: WindSample): TrajectoryWindUsed {
  const movementDirectionToDeg = windDirectionFromToMovementDirection(
    sample.wind.directionFromDeg,
  );
  return {
    queryAltitudeAmslM: sample.query.altitudeAmslM,
    speedMps: sample.wind.speedMps,
    directionFromDeg: sample.wind.directionFromDeg,
    movementDirectionToDeg,
    sourceModel: sample.sourceModel,
    sourceLatitude: sample.sourceLatitude,
    sourceLongitude: sample.sourceLongitude,
    sourceSlices: sample.sourceSlices.map((slice) => ({
      validAt: slice.validAt,
      lowerLevel: {
        ...(slice.lowerLevel.pressureHpa === undefined
          ? {}
          : { pressureHpa: slice.lowerLevel.pressureHpa }),
        geopotentialHeightAmslM:
          slice.lowerLevel.geopotentialHeightAmslM,
      },
      upperLevel: {
        ...(slice.upperLevel.pressureHpa === undefined
          ? {}
          : { pressureHpa: slice.upperLevel.pressureHpa }),
        geopotentialHeightAmslM:
          slice.upperLevel.geopotentialHeightAmslM,
      },
      verticalInterpolationRatio: slice.verticalInterpolationRatio,
    })),
    ...(sample.temporalInterpolation
      ? { temporalInterpolation: { ...sample.temporalInterpolation } }
      : {}),
  };
}

function appendProviderWarnings(
  warnings: TrajectoryWarning[],
  messages: readonly string[],
): void {
  for (const message of messages) {
    if (
      !warnings.some(
        (warning) =>
          warning.code === "WEATHER_PROVIDER_WARNING" &&
          warning.message === message,
      )
    ) {
      warnings.push({ code: "WEATHER_PROVIDER_WARNING", message });
    }
  }
}

async function getWindForStep(
  provider: WindProvider,
  query: WindQuery,
  stepIndex: number,
  elapsedSeconds: number,
): Promise<WindSample> {
  try {
    const sample = await provider.getWind(query);
    assertUsableWindSample(sample);
    return sample;
  } catch (error) {
    if (error instanceof TrajectoryDomainError) {
      throw new TrajectoryDomainError(error.code, error.message, {
        ...error.details,
        stepIndex,
        elapsedSeconds,
        altitudeAmslM: query.altitudeAmslM,
        validAt: query.validAt,
      });
    }
    throw new TrajectoryDomainError(
      "UPSTREAM_UNAVAILABLE",
      "Le vent nécessaire à la projection est indisponible.",
      {
        stepIndex,
        elapsedSeconds,
        altitudeAmslM: query.altitudeAmslM,
        validAt: query.validAt,
        cause: error instanceof Error ? error.name : "UnknownError",
      },
    );
  }
}

export async function projectTrajectory(
  rawInput: TrajectoryProjectionInput,
  provider: WindProvider,
  options: { stepSeconds?: number } = {},
): Promise<TrajectoryProjectionResult> {
  const input = validateTrajectoryEngineInput(rawInput);
  const stepSeconds =
    options.stepSeconds ?? DEFAULT_TRAJECTORY_STEP_SECONDS;
  assertValidStep(stepSeconds);
  const profile = computeVerticalProfile(input);
  const startedAtMs = Date.parse(input.departureTime);
  const startedAt = new Date(startedAtMs).toISOString();
  const initialAltitude = profile.hasClimb
    ? profile.terrainAltitudeAmslM!
    : input.targetAltitudeAmslM;
  const initialQuery: WindQuery = {
    latitude: input.start.latitude,
    longitude: input.start.longitude,
    validAt: startedAt,
    altitudeAmslM: initialAltitude,
    weatherModel: input.weatherModel,
  };
  const projectionProvider = await prepareProjectionProvider(
    provider,
    initialQuery,
  );
  const points: TrajectoryPoint[] = [
    {
      latitude: input.start.latitude,
      longitude: input.start.longitude,
      timestamp: startedAt,
      elapsedSeconds: 0,
      altitudeAmslM: initialAltitude,
      verticalPhase: "initial",
    },
  ];
  const warnings: TrajectoryWarning[] = [{ ...LAUNCH_COLUMN_WARNING }];
  const sourceModels = new Set<string>();
  let elapsedSeconds = 0;
  let currentLatitude = input.start.latitude;
  let currentLongitude = input.start.longitude;
  let stepIndex = 0;

  while (
    elapsedSeconds <
    input.durationSeconds - FLOAT_COMPARISON_TOLERANCE
  ) {
    const segmentPhase = phaseAt(elapsedSeconds, profile);
    const segmentEndElapsedSeconds = nextSegmentEnd(
      elapsedSeconds,
      input.durationSeconds,
      stepSeconds,
      profile,
    );
    const segmentDurationSeconds =
      segmentEndElapsedSeconds - elapsedSeconds;
    const segmentStartAltitude = altitudeAt(elapsedSeconds, profile);
    const segmentEndAltitude = altitudeAt(
      segmentEndElapsedSeconds,
      profile,
    );
    const queryAltitudeAmslM =
      segmentPhase === "level"
        ? input.targetAltitudeAmslM
        : (segmentStartAltitude + segmentEndAltitude) / 2;
    const query: WindQuery = {
      latitude: input.start.latitude,
      longitude: input.start.longitude,
      validAt: new Date(
        startedAtMs + elapsedSeconds * 1000,
      ).toISOString(),
      altitudeAmslM: queryAltitudeAmslM,
      weatherModel: input.weatherModel,
    };
    const sample = await getWindForStep(
      projectionProvider,
      query,
      stepIndex,
      elapsedSeconds,
    );
    const windUsed = compactWindTrace(sample);
    const distanceKm =
      (sample.wind.speedMps * segmentDurationSeconds) / 1000;
    const [rawLongitude, nextLatitude] =
      distanceKm === 0
        ? [currentLongitude, currentLatitude]
        : destinationPoint(
            currentLatitude,
            currentLongitude,
            distanceKm,
            windUsed.movementDirectionToDeg,
          );
    const nextLongitude =
      distanceKm === 0 ? rawLongitude : normalizeLongitude(rawLongitude);

    if (
      !Number.isFinite(nextLatitude) ||
      nextLatitude < -90 ||
      nextLatitude > 90 ||
      !Number.isFinite(nextLongitude)
    ) {
      throw new TrajectoryDomainError(
        "NON_FINITE_GEOGRAPHIC_RESULT",
        "Le calcul géographique a produit une position inexploitable.",
        { stepIndex, elapsedSeconds },
      );
    }

    elapsedSeconds =
      Math.abs(segmentEndElapsedSeconds - input.durationSeconds) <=
      FLOAT_COMPARISON_TOLERANCE
        ? input.durationSeconds
        : segmentEndElapsedSeconds;
    stepIndex += 1;
    currentLatitude = nextLatitude;
    currentLongitude = nextLongitude;
    sourceModels.add(sample.sourceModel);
    appendProviderWarnings(warnings, sample.warnings);
    points.push({
      latitude: currentLatitude,
      longitude: currentLongitude,
      timestamp: new Date(
        startedAtMs + elapsedSeconds * 1000,
      ).toISOString(),
      elapsedSeconds,
      altitudeAmslM: segmentEndAltitude,
      verticalPhase: segmentPhase,
      windUsed,
    });
  }

  return {
    mode: profile.mode,
    spatialStrategy: "launch-column",
    points,
    startedAt,
    endedAt: new Date(
      startedAtMs + input.durationSeconds * 1000,
    ).toISOString(),
    durationSeconds: input.durationSeconds,
    stepSeconds,
    targetAltitudeAmslM: input.targetAltitudeAmslM,
    verticalProfile: {
      ...(profile.terrainAltitudeAmslM === undefined
        ? {}
        : {
            terrainAltitudeAmslM:
              profile.terrainAltitudeAmslM,
          }),
      targetAltitudeAmslM: profile.targetAltitudeAmslM,
      ...(profile.climbRateMps === undefined
        ? {}
        : {
            climbRateMps: profile.climbRateMps,
            climbDurationSeconds: profile.climbDurationSeconds,
            ...(profile.climbEndElapsedSeconds === undefined
              ? {}
              : {
                  climbEndElapsedSeconds:
                    profile.climbEndElapsedSeconds,
                }),
          }),
      ...(profile.descentRateMps === undefined
        ? {}
        : {
            descentRateMps: profile.descentRateMps,
            descentDurationSeconds: profile.descentDurationSeconds,
            ...(profile.descentStartElapsedSeconds === undefined
              ? {}
              : {
                  descentStartElapsedSeconds:
                    profile.descentStartElapsedSeconds,
                }),
          }),
    },
    weatherModel: input.weatherModel,
    weatherSourceModels: [...sourceModels],
    warnings,
  };
}

/**
 * Compatibilité avec l’étape 3. Le résultat suit désormais le profil fourni.
 */
export function projectConstantAltitudeTrajectory(
  input: TrajectoryProjectionInput,
  provider: WindProvider,
  options: { stepSeconds?: number } = {},
): Promise<TrajectoryProjectionResult> {
  return projectTrajectory(input, provider, options);
}
