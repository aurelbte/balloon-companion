import type { LaunchSite } from "./trajectory/types.ts";
import type { AltitudeOption } from "./trajectory/integration.ts";

/**
 * Vue historique encore consommée par les écrans Prépa, Briefing et Carte.
 * Elle reste disponible pendant la migration progressive vers la préparation V2.
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

const STORAGE_KEY = "balloon_companion_flight";

const LEGACY_TO_PROVIDER_MODEL: Record<string, string> = {
  AROME: "arome_seamless",
  ICON: "icon_seamless",
  GFS: "gfs_seamless",
};

const PROVIDER_TO_LEGACY_MODEL: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_TO_PROVIDER_MODEL).map(([legacy, provider]) => [
    provider,
    legacy,
  ]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAscentRateMps(value: unknown): value is number | undefined {
  return value === undefined || (isFiniteNumber(value) && value > 0 && value <= 7);
}

function isDescentRateMps(value: unknown): value is number | undefined {
  return value === undefined || (isFiniteNumber(value) && value < 0 && value >= -7);
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

function isoToLegacyDateTime(value: string | null): {
  date: string;
  time: string;
} {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
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
        ? { ascentRateMps: Math.min(7, value.ascentRateMPerMin / 60) }
        : isFiniteNumber(value.climbRateMps) && value.climbRateMps > 0
          ? { ascentRateMps: Math.min(7, value.climbRateMps) }
          : {}),
      ...(isFiniteNumber(value.descentRateMPerMin) && value.descentRateMPerMin > 0
        ? { descentRateMps: -Math.min(7, value.descentRateMPerMin / 60) }
        : isFiniteNumber(value.descentRateMps) && value.descentRateMps > 0
          ? { descentRateMps: -Math.min(7, value.descentRateMps) }
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

export function saveFlightPreparation(
  preparation: StoredFlightPreparationV2,
): boolean {
  if (typeof window === "undefined") return false;
  const validated = migrateStoredPreparation(preparation);
  if (!validated) return false;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
    return true;
  } catch (error) {
    console.error("Erreur lors de la sauvegarde de la préparation:", error);
    return false;
  }
}

export function getFlightPreparation(): StoredFlightPreparationV2 | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? migrateStoredPreparation(JSON.parse(stored)) : null;
  } catch (error) {
    console.error("Erreur lors de la lecture de la préparation:", error);
    return null;
  }
}

/**
 * Compatibilité temporaire avec l’interface actuelle.
 * Une modification du nom de terrain invalide tout ancien point résolu.
 */
export function saveCurrentFlight(flight: Flight): boolean {
  const existing = getFlightPreparation();
  const now = Date.now();
  const terrainName = flight.terrain.trim();
  const preservedLaunchSite =
    existing?.launchSite?.name === terrainName ? existing.launchSite : null;

  return saveFlightPreparation({
    storageVersion: PREPARATION_STORAGE_VERSION,
    launchSite: preservedLaunchSite,
    ...(!preservedLaunchSite && terrainName
      ? { unresolvedLaunchSiteName: terrainName }
      : {}),
    departureTime: legacyDateTimeToIso(flight.date, flight.heure),
    durationMinutes: parseDurationMinutes(flight.duree),
    weatherModel:
      LEGACY_TO_PROVIDER_MODEL[flight.meteo] ?? flight.meteo.trim(),
    targetAltitudeAmslM: existing?.targetAltitudeAmslM ?? null,
    ...(existing?.ascentRateMps
      ? { ascentRateMps: existing.ascentRateMps }
      : {}),
    ...(existing?.descentRateMps
      ? { descentRateMps: existing.descentRateMps }
      : {}),
    ...(flight.ballon.trim() ? { balloonName: flight.ballon.trim() } : {}),
    ...(existing?.occupantsWeightKg !== undefined
      ? { occupantsWeightKg: existing.occupantsWeightKg }
      : {}),
    createdAt: existing?.createdAt ?? flight.createdAt ?? now,
    updatedAt: now,
  });
}

export function getCurrentFlight(): Flight | null {
  const preparation = getFlightPreparation();
  if (!preparation) return null;

  const departure = isoToLegacyDateTime(preparation.departureTime);
  return {
    terrain:
      preparation.launchSite?.name ??
      preparation.unresolvedLaunchSiteName ??
      "",
    date: departure.date,
    heure: departure.time,
    duree:
      preparation.durationMinutes === null
        ? ""
        : `${preparation.durationMinutes} min`,
    ballon: preparation.balloonName ?? "",
    meteo:
      PROVIDER_TO_LEGACY_MODEL[preparation.weatherModel] ??
      preparation.weatherModel,
    createdAt: preparation.createdAt,
    updatedAt: preparation.updatedAt,
  };
}

export function clearCurrentFlight(): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error("Erreur lors de l’effacement de la préparation:", error);
    return false;
  }
}
