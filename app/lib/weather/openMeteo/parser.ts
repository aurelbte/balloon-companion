import {
  TrajectoryDomainError,
  type WindLevelUsed,
} from "../../trajectory/types.ts";
import {
  OPEN_METEO_PRESSURE_LEVELS_HPA,
  OPEN_METEO_NEAR_SURFACE_LEVELS_AGL_M,
  type OpenMeteoWeatherModel,
  type OpenMeteoWindColumn,
} from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valueAt(values: unknown, index: number): number | null {
  return Array.isArray(values) ? finiteNumber(values[index]) : null;
}

function normalizeUtcTime(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : `${value}Z`;
  return Number.isFinite(Date.parse(withZone))
    ? new Date(withZone).toISOString()
    : null;
}

function assertExpectedUnits(hourlyUnits: UnknownRecord) {
  for (const [name, unit] of Object.entries(hourlyUnits)) {
    // Certains modèles déclarent explicitement "undefined" pour une variable
    // non produite. Le niveau sera rejeté individuellement lors du parsing.
    if (unit === "undefined" || unit === null) continue;
    if (name.startsWith("wind_speed_") && unit !== "m/s") {
      throw new TrajectoryDomainError(
        "INVALID_PROVIDER_RESPONSE",
        "Open-Meteo n’a pas renvoyé les vitesses en m/s.",
        { name, unit },
      );
    }
    if (name.startsWith("wind_direction_") && unit !== "°") {
      throw new TrajectoryDomainError(
        "INVALID_PROVIDER_RESPONSE",
        "Open-Meteo n’a pas renvoyé les directions en degrés.",
        { name, unit },
      );
    }
    if (name.startsWith("geopotential_height_") && unit !== "m") {
      throw new TrajectoryDomainError(
        "INVALID_PROVIDER_RESPONSE",
        "Open-Meteo n’a pas renvoyé les hauteurs géopotentielles en mètres.",
        { name, unit },
      );
    }
  }
}

export function parseOpenMeteoWindColumn(
  payload: unknown,
  sourceModel: OpenMeteoWeatherModel,
  terrainAltitudeAmslM?: number,
): OpenMeteoWindColumn {
  if (!isRecord(payload)) {
    throw new TrajectoryDomainError(
      "INVALID_PROVIDER_RESPONSE",
      "La réponse Open-Meteo n’est pas un objet JSON valide.",
    );
  }
  if (payload.error === true) {
    throw new TrajectoryDomainError(
      "UPSTREAM_UNAVAILABLE",
      typeof payload.reason === "string"
        ? payload.reason
        : "Open-Meteo a refusé la requête.",
    );
  }

  const sourceLatitude = finiteNumber(payload.latitude);
  const sourceLongitude = finiteNumber(payload.longitude);
  const sourceElevationAmslM = finiteNumber(payload.elevation);
  const terrainAltitude =
    typeof terrainAltitudeAmslM === "number" &&
    Number.isFinite(terrainAltitudeAmslM)
      ? terrainAltitudeAmslM
      : sourceElevationAmslM;
  const hourly = isRecord(payload.hourly) ? payload.hourly : null;
  const hourlyUnits = isRecord(payload.hourly_units)
    ? payload.hourly_units
    : null;

  if (
    sourceLatitude === null ||
    sourceLongitude === null ||
    !hourly ||
    !hourlyUnits ||
    !Array.isArray(hourly.time)
  ) {
    throw new TrajectoryDomainError(
      "INVALID_PROVIDER_RESPONSE",
      "La réponse Open-Meteo ne contient pas la colonne météo attendue.",
    );
  }

  assertExpectedUnits(hourlyUnits);

  const slices = hourly.time.flatMap((rawTime, index) => {
    const validAt = normalizeUtcTime(rawTime);
    if (!validAt) return [];

    const candidates: WindLevelUsed[] = [];
    const rejectedLevels: Array<{ sourceLevel: string; reason: string }> = [];

    for (const heightAglM of OPEN_METEO_NEAR_SURFACE_LEVELS_AGL_M) {
      const speed = valueAt(hourly[`wind_speed_${heightAglM}m`], index);
      const direction = valueAt(
        hourly[`wind_direction_${heightAglM}m`],
        index,
      );
      if (
        terrainAltitude === null ||
        speed === null ||
        speed < 0 ||
        direction === null
      ) {
        rejectedLevels.push({
          sourceLevel: `${heightAglM} m AGL`,
          reason: "Vent proche du sol incomplet",
        });
        continue;
      }
      if (heightAglM === 10) {
        // Open-Meteo ne fournit pas un vent à 0 m AGL. Le point terrain est
        // volontairement une approximation explicite du vent réel à 10 m AGL.
        candidates.push({
          geopotentialHeightAmslM: terrainAltitude,
          windSpeedMps: speed,
          windDirectionFromDeg: direction,
          sourceType: "surface",
          sourceLevel: "vent 10 m AGL appliqué à l’altitude terrain",
          isApproximation: true,
        });
      }
      candidates.push({
        geopotentialHeightAmslM: terrainAltitude + heightAglM,
        windSpeedMps: speed,
        windDirectionFromDeg: direction,
        sourceType: "near-surface",
        sourceLevel: `${heightAglM} m AGL`,
      });
    }

    for (const pressureHpa of OPEN_METEO_PRESSURE_LEVELS_HPA) {
      const windSpeedMps = valueAt(
        hourly[`wind_speed_${pressureHpa}hPa`],
        index,
      );
      const windDirectionFromDeg = valueAt(
        hourly[`wind_direction_${pressureHpa}hPa`],
        index,
      );
      const geopotentialHeightAmslM = valueAt(
        hourly[`geopotential_height_${pressureHpa}hPa`],
        index,
      );

      // Un niveau incomplet est absent. Aucune composante n’est remplacée.
      if (
        windSpeedMps === null ||
        windSpeedMps < 0 ||
        windDirectionFromDeg === null ||
        geopotentialHeightAmslM === null
      ) {
        rejectedLevels.push({
          sourceLevel: `${pressureHpa} hPa`,
          reason:
            geopotentialHeightAmslM === null
              ? "Hauteur géopotentielle absente"
              : "Vent de pression incomplet",
        });
        continue;
      }

      if (
        terrainAltitude !== null &&
        geopotentialHeightAmslM < terrainAltitude - 1
      ) {
        rejectedLevels.push({
          sourceLevel: `${pressureHpa} hPa`,
          reason: "Niveau situé sous le terrain",
        });
        continue;
      }

      candidates.push({
        pressureHpa,
        geopotentialHeightAmslM,
        windSpeedMps,
        windDirectionFromDeg,
        sourceType: "pressure-level",
        sourceLevel: `${pressureHpa} hPa`,
      });
    }

    candidates.sort(
      (left, right) =>
        left.geopotentialHeightAmslM - right.geopotentialHeightAmslM,
    );
    const levels: WindLevelUsed[] = [];
    for (const candidate of candidates) {
      const previous = levels.at(-1);
      if (
        previous &&
        Math.abs(
          previous.geopotentialHeightAmslM -
            candidate.geopotentialHeightAmslM,
        ) <= 1
      ) {
        rejectedLevels.push({
          sourceLevel: candidate.sourceLevel ?? "niveau inconnu",
          reason: `Doublon à moins de 1 m de ${previous.sourceLevel ?? "un autre niveau"}`,
        });
        continue;
      }
      levels.push(candidate);
    }

    if (levels.length < 2) return [];
    return [{ validAt, levels, rejectedLevels }];
  });

  if (slices.length === 0) {
    throw new TrajectoryDomainError(
      "MISSING_WIND_DATA",
      "Open-Meteo n’a renvoyé aucune échéance météo exploitable.",
    );
  }

  return {
    sourceModel,
    sourceLatitude,
    sourceLongitude,
    ...(sourceElevationAmslM === null ? {} : { sourceElevationAmslM }),
    slices,
  };
}

export function parseOpenMeteoElevation(payload: unknown): number {
  if (!isRecord(payload)) {
    throw new TrajectoryDomainError(
      "INVALID_PROVIDER_RESPONSE",
      "La réponse d’élévation Open-Meteo est invalide.",
    );
  }
  if (payload.error === true) {
    throw new TrajectoryDomainError(
      "ELEVATION_UNAVAILABLE",
      typeof payload.reason === "string"
        ? payload.reason
        : "L’élévation du terrain est indisponible.",
    );
  }

  const elevation = Array.isArray(payload.elevation)
    ? finiteNumber(payload.elevation[0])
    : null;
  if (elevation === null) {
    throw new TrajectoryDomainError(
      "ELEVATION_UNAVAILABLE",
      "L’élévation du terrain est absente de la réponse Open-Meteo.",
    );
  }
  return elevation;
}
