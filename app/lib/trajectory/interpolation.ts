import {
  TrajectoryDomainError,
  type WindLevelUsed,
  type WindSourceSlice,
  type WindVector,
} from "./types.ts";
import { interpolateWindVectors } from "./windMath.ts";

export type VerticalWindInterpolation = {
  wind: WindVector;
  lowerLevel: WindLevelUsed;
  upperLevel: WindLevelUsed;
  ratio: number;
};

function levelWind(level: WindLevelUsed): WindVector {
  return {
    speedMps: level.windSpeedMps,
    directionFromDeg: level.windDirectionFromDeg,
  };
}

export function interpolateWindAtAltitude(
  levels: readonly WindLevelUsed[],
  altitudeAmslM: number,
): VerticalWindInterpolation {
  const validLevels = levels
    .filter(
      (level) =>
        Number.isFinite(level.geopotentialHeightAmslM) &&
        Number.isFinite(level.windSpeedMps) &&
        level.windSpeedMps >= 0 &&
        Number.isFinite(level.windDirectionFromDeg),
    )
    .sort(
      (left, right) =>
        left.geopotentialHeightAmslM - right.geopotentialHeightAmslM,
    );

  if (validLevels.length === 0) {
    throw new TrajectoryDomainError(
      "MISSING_WIND_DATA",
      "Aucun niveau de vent valide n’est disponible.",
    );
  }

  const exact = validLevels.find(
    (level) =>
      Math.abs(level.geopotentialHeightAmslM - altitudeAmslM) < 1e-6,
  );
  if (exact) {
    return {
      wind: levelWind(exact),
      lowerLevel: exact,
      upperLevel: exact,
      ratio: 0,
    };
  }

  for (let index = 0; index < validLevels.length - 1; index += 1) {
    const lowerLevel = validLevels[index];
    const upperLevel = validLevels[index + 1];
    if (
      lowerLevel.geopotentialHeightAmslM < altitudeAmslM &&
      upperLevel.geopotentialHeightAmslM > altitudeAmslM
    ) {
      const ratio =
        (altitudeAmslM - lowerLevel.geopotentialHeightAmslM) /
        (upperLevel.geopotentialHeightAmslM -
          lowerLevel.geopotentialHeightAmslM);
      return {
        wind: interpolateWindVectors(
          levelWind(lowerLevel),
          levelWind(upperLevel),
          ratio,
        ),
        lowerLevel,
        upperLevel,
        ratio,
      };
    }
  }

  throw new TrajectoryDomainError(
    "WEATHER_VERTICAL_COVERAGE_INSUFFICIENT",
    "L’altitude demandée n’est pas encadrée par deux niveaux météo réels.",
    {
      altitudeAmslM,
      lowestAvailableAmslM: validLevels[0].geopotentialHeightAmslM,
      highestAvailableAmslM:
        validLevels[validLevels.length - 1].geopotentialHeightAmslM,
    },
  );
}

export function interpolateWindSlicesInTime(
  before: WindSourceSlice,
  after: WindSourceSlice,
  validAt: string,
): {
  wind: WindVector;
  ratio: number;
} {
  const beforeMs = Date.parse(before.validAt);
  const afterMs = Date.parse(after.validAt);
  const targetMs = Date.parse(validAt);

  if (
    !Number.isFinite(beforeMs) ||
    !Number.isFinite(afterMs) ||
    !Number.isFinite(targetMs) ||
    targetMs < beforeMs ||
    targetMs > afterMs ||
    afterMs < beforeMs
  ) {
    throw new TrajectoryDomainError(
      "TIME_NOT_BRACKETED",
      "L’heure demandée n’est pas encadrée par deux échéances météo.",
    );
  }

  if (afterMs === beforeMs) {
    return { wind: before.wind, ratio: 0 };
  }

  const ratio = (targetMs - beforeMs) / (afterMs - beforeMs);
  return {
    wind: interpolateWindVectors(before.wind, after.wind, ratio),
    ratio,
  };
}
