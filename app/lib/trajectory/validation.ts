import {
  TrajectoryDomainError,
  type GeoPoint,
  type TrajectoryProjectionInput,
  type TrajectoryValidationDraft,
  type WindQuery,
} from "./types.ts";

const ISO_DATE_TIME_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isValidCoordinate(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function isValidIsoDateTime(value: string): boolean {
  return (
    ISO_DATE_TIME_WITH_ZONE.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function assertPositiveOptionalRate(
  value: number | undefined,
  code: "INVALID_CLIMB_RATE" | "INVALID_DESCENT_RATE",
  label: string,
) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TrajectoryDomainError(
      code,
      `${label} doit être un nombre strictement positif.`,
    );
  }
}

export function validateTrajectoryInput(
  draft: TrajectoryValidationDraft,
  supportedWeatherModels: readonly string[],
): TrajectoryProjectionInput {
  if (!isValidCoordinate(draft.start)) {
    throw new TrajectoryDomainError(
      "INVALID_COORDINATES",
      "Le point de départ est invalide.",
    );
  }

  if (!draft.start.name.trim()) {
    throw new TrajectoryDomainError(
      "INVALID_COORDINATES",
      "Le nom du point de départ est requis.",
    );
  }

  if (!isValidIsoDateTime(draft.departureTime)) {
    throw new TrajectoryDomainError(
      "INVALID_DATE",
      "La date de décollage doit être une date ISO avec fuseau horaire.",
    );
  }

  if (!Number.isFinite(draft.durationSeconds) || draft.durationSeconds <= 0) {
    throw new TrajectoryDomainError(
      "INVALID_DURATION",
      "La durée de projection doit être strictement positive.",
    );
  }

  if (draft.targetAltitudeAmslM === null || draft.targetAltitudeAmslM === undefined) {
    throw new TrajectoryDomainError(
      "MISSING_TARGET_ALTITUDE",
      "Une altitude cible AMSL explicite est requise.",
    );
  }

  if (
    !Number.isFinite(draft.targetAltitudeAmslM) ||
    draft.targetAltitudeAmslM < 0
  ) {
    throw new TrajectoryDomainError(
      "INVALID_TARGET_ALTITUDE",
      "L’altitude cible AMSL est invalide.",
    );
  }

  if (!supportedWeatherModels.includes(draft.weatherModel)) {
    throw new TrajectoryDomainError(
      "UNSUPPORTED_WEATHER_MODEL",
      "Le modèle météo sélectionné n’est pas disponible.",
      { weatherModel: draft.weatherModel },
    );
  }

  assertPositiveOptionalRate(
    draft.climbRateMps,
    "INVALID_CLIMB_RATE",
    "Le taux de montée",
  );
  assertPositiveOptionalRate(
    draft.descentRateMps,
    "INVALID_DESCENT_RATE",
    "Le taux de descente",
  );

  return {
    ...draft,
    start: { ...draft.start, name: draft.start.name.trim() },
    targetAltitudeAmslM: draft.targetAltitudeAmslM,
  };
}

/**
 * Validation indépendante d’un fournisseur. Le support exact du modèle reste
 * la responsabilité du WindProvider sélectionné.
 */
export function validateTrajectoryEngineInput(
  draft: TrajectoryValidationDraft,
): TrajectoryProjectionInput {
  if (!draft.weatherModel.trim()) {
    throw new TrajectoryDomainError(
      "UNSUPPORTED_WEATHER_MODEL",
      "Le modèle météo sélectionné n’est pas disponible.",
    );
  }
  return validateTrajectoryInput(draft, [draft.weatherModel]);
}

export function validateWindQuery(
  query: WindQuery,
  supportedWeatherModels: readonly string[],
): WindQuery {
  if (!isValidCoordinate(query)) {
    throw new TrajectoryDomainError(
      "INVALID_COORDINATES",
      "Les coordonnées de la requête météo sont invalides.",
    );
  }
  if (!isValidIsoDateTime(query.validAt)) {
    throw new TrajectoryDomainError(
      "INVALID_DATE",
      "L’heure météo demandée doit être une date ISO avec fuseau horaire.",
    );
  }
  if (!Number.isFinite(query.altitudeAmslM) || query.altitudeAmslM < 0) {
    throw new TrajectoryDomainError(
      "INVALID_TARGET_ALTITUDE",
      "L’altitude météo demandée est invalide.",
    );
  }
  if (!supportedWeatherModels.includes(query.weatherModel)) {
    throw new TrajectoryDomainError(
      "UNSUPPORTED_WEATHER_MODEL",
      "Le modèle météo demandé n’est pas disponible.",
      { weatherModel: query.weatherModel },
    );
  }
  return query;
}
