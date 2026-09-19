import type { LaunchSite } from "./trajectory/types.ts";
import type { AltitudeOption } from "./trajectory/integration.ts";
import { isValidTimeZone } from "./timeZone.ts";

/**
 * Format historique reconnu par la migration pure des drafts modernes.
 */
export interface Flight {
  terrain: string;
  date: string;
  heure: string;
  duree: string;
  ballon: string;
  meteo: string;
  createdAt?: number;
  updatedAt?: number;
}

export const PREPARATION_STORAGE_VERSION = 3 as const;

export interface StoredFlightPreparationV2 {
  storageVersion: typeof PREPARATION_STORAGE_VERSION;
  launchSite: LaunchSite | null;
  /**
   * Libellé historique conservé sans lui attribuer de coordonnées.
   * Il ne constitue pas un point de départ utilisable pour une projection.
   */
  unresolvedLaunchSiteName?: string;
  departureTime: string | null;
  launchTimeZone?: string;
  durationMinutes: number | null;
  weatherModel: string;
  targetAltitudeAmslM: number | null;
  selectedAltitudes?: AltitudeOption[];
  primaryAltitudeAmslM?: number;
  /** Taux pilote positif, en mètres par seconde. */
  ascentRateMps?: number;
  /** Taux pilote négatif, en mètres par seconde. */
  descentRateMps?: number;
  balloonName?: string;
  /** Poids total déclaré du pilote et des passagers, sans équipement ni aéronef. */
  occupantsWeightKg?: number;
  createdAt: number;
  updatedAt: number;
}


const LEGACY_TO_PROVIDER_MODEL: Record<string, string> = {
  AROME: "arome_seamless",
  ICON: "icon_seamless",
  GFS: "gfs_seamless",
};


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAscentRateMps(value: unknown): value is number | undefined {
  return value === undefined || (isFiniteNumber(value) && value > 0 && value <= 10);
}

function isDescentRateMps(value: unknown): value is number | undefined {
  return value === undefined || (isFiniteNumber(value) && value < 0 && value >= -10);
}

function parseDurationMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*min$/i);
  if (!match) return null;
  const duration = Number(match[1].replace(",", "."));
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function legacyDateTimeToIso(date: string, time: string): string | null {
  if (!date.trim() || !time.trim()) return null;
  const localDate = new Date(`${date}T${time}:00`);
  return Number.isFinite(localDate.getTime()) ? localDate.toISOString() : null;
}


function parseLaunchSite(value: unknown): LaunchSite | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    !isFiniteNumber(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    !isFiniteNumber(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    (value.terrainAltitudeAmslM !== undefined &&
      !isFiniteNumber(value.terrainAltitudeAmslM))
  ) {
    return null;
  }

  return {
    name: value.name.trim(),
    latitude: value.latitude,
    longitude: value.longitude,
    ...(isFiniteNumber(value.terrainAltitudeAmslM)
      ? { terrainAltitudeAmslM: value.terrainAltitudeAmslM }
      : {}),
  };
}

function parseV2Preparation(
  value: Record<string, unknown>,
): StoredFlightPreparationV2 | null {
  if (value.storageVersion !== PREPARATION_STORAGE_VERSION) return null;

  const launchSite =
    value.launchSite === null ? null : parseLaunchSite(value.launchSite);
  if (value.launchSite !== null && launchSite === null) return null;
  if (
    value.departureTime !== null &&
    (typeof value.departureTime !== "string" ||
      !Number.isFinite(Date.parse(value.departureTime)))
  ) {
    return null;
  }
  if (
    value.durationMinutes !== null &&
    (!isFiniteNumber(value.durationMinutes) || value.durationMinutes <= 0)
  ) {
    return null;
  }
  if (
    typeof value.weatherModel !== "string" ||
    (value.targetAltitudeAmslM !== null &&
      (!isFiniteNumber(value.targetAltitudeAmslM) ||
        value.targetAltitudeAmslM < 0)) ||
    !isAscentRateMps(value.ascentRateMps) ||
    !isDescentRateMps(value.descentRateMps) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt)
  ) {
    return null;
  }

  return {
    storageVersion: PREPARATION_STORAGE_VERSION,
    launchSite,
    ...(typeof value.unresolvedLaunchSiteName === "string" &&
    value.unresolvedLaunchSiteName.trim()
      ? { unresolvedLaunchSiteName: value.unresolvedLaunchSiteName.trim() }
      : {}),
    departureTime: value.departureTime as string | null,
    ...(isValidTimeZone(value.launchTimeZone) ? { launchTimeZone: value.launchTimeZone } : {}),
    durationMinutes: value.durationMinutes as number | null,
    weatherModel: value.weatherModel,
    targetAltitudeAmslM: value.targetAltitudeAmslM as number | null,
    ...(Array.isArray(value.selectedAltitudes)
      ? { selectedAltitudes: value.selectedAltitudes as AltitudeOption[] }
      : {}),
    ...(isFiniteNumber(value.primaryAltitudeAmslM)
      ? { primaryAltitudeAmslM: value.primaryAltitudeAmslM }
      : {}),
    ...(isFiniteNumber(value.ascentRateMps)
      ? { ascentRateMps: value.ascentRateMps }
      : {}),
    ...(isFiniteNumber(value.descentRateMps)
      ? { descentRateMps: value.descentRateMps }
      : {}),
    ...(typeof value.balloonName === "string"
      ? { balloonName: value.balloonName }
      : {}),
    ...((isFiniteNumber(value.occupantsWeightKg) && value.occupantsWeightKg > 0) ||
    (isFiniteNumber(value.passengerWeightKg) && value.passengerWeightKg > 0)
      ? { occupantsWeightKg: isFiniteNumber(value.occupantsWeightKg) ? value.occupantsWeightKg : value.passengerWeightKg as number }
      : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isLegacyFlight(
  value: Record<string, unknown>,
): value is Record<string, unknown> & Flight {
  return (
    typeof value.terrain === "string" &&
    typeof value.date === "string" &&
    typeof value.heure === "string" &&
    typeof value.duree === "string" &&
    typeof value.ballon === "string" &&
    typeof value.meteo === "string"
  );
}

/**
 * Migration pure : un ancien nom de terrain reste non résolu.
 * Aucune coordonnée, altitude ou valeur météo n’est inventée.
 */
export function migrateStoredPreparation(
  value: unknown,
  now: number = Date.now(),
): StoredFlightPreparationV2 | null {
  if (!isRecord(value)) return null;

  const v2 = parseV2Preparation(value);
  if (v2) return v2;
  if (value.storageVersion === 2) {
    const migratedRates = {
      ...(isFiniteNumber(value.ascentRateMPerMin) && value.ascentRateMPerMin > 0
        ? { ascentRateMps: Math.min(10, value.ascentRateMPerMin / 60) }
        : isFiniteNumber(value.climbRateMps) && value.climbRateMps > 0
          ? { ascentRateMps: Math.min(10, value.climbRateMps) }
          : {}),
      ...(isFiniteNumber(value.descentRateMPerMin) && value.descentRateMPerMin > 0
        ? { descentRateMps: -Math.min(10, value.descentRateMPerMin / 60) }
        : isFiniteNumber(value.descentRateMps) && value.descentRateMps > 0
          ? { descentRateMps: -Math.min(10, value.descentRateMps) }
          : {}),
    };
    return parseV2Preparation({
      ...value,
      storageVersion: PREPARATION_STORAGE_VERSION,
      ...migratedRates,
      ascentRateMPerMin: undefined,
      descentRateMPerMin: undefined,
    });
  }
  if (!isLegacyFlight(value)) return null;

  const createdAt = isFiniteNumber(value.createdAt) ? value.createdAt : now;
  const updatedAt = isFiniteNumber(value.updatedAt) ? value.updatedAt : now;
  const terrainName = value.terrain.trim();

  return {
    storageVersion: PREPARATION_STORAGE_VERSION,
    launchSite: null,
    ...(terrainName ? { unresolvedLaunchSiteName: terrainName } : {}),
    departureTime: legacyDateTimeToIso(value.date, value.heure),
    durationMinutes: parseDurationMinutes(value.duree),
    weatherModel:
      LEGACY_TO_PROVIDER_MODEL[value.meteo] ?? value.meteo.trim(),
    targetAltitudeAmslM: null,
    ...(value.ballon.trim() ? { balloonName: value.ballon.trim() } : {}),
    createdAt,
    updatedAt,
  };
}
