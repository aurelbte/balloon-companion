import {
  interpolateWindAtAltitude,
  interpolateWindSlicesInTime,
} from "../../trajectory/interpolation.ts";
import {
  TrajectoryDomainError,
  type WindProvider,
  type WindQuery,
  type WindSourceSlice,
  type WindSample,
} from "../../trajectory/types.ts";
import { validateWindQuery } from "../../trajectory/validation.ts";
import { parseOpenMeteoWindColumn } from "./parser.ts";
import {
  OPEN_METEO_WEATHER_MODELS,
  type OpenMeteoClient,
  type OpenMeteoWeatherModel,
  type OpenMeteoWindColumnSlice,
  type OpenMeteoWindColumn,
} from "./types.ts";

function isSupportedModel(value: string): value is OpenMeteoWeatherModel {
  return OPEN_METEO_WEATHER_MODELS.some((model) => model === value);
}

function buildSourceSlice(
  source: OpenMeteoWindColumnSlice,
  altitudeAmslM: number,
): WindSourceSlice {
  const vertical = interpolateWindAtAltitude(source.levels, altitudeAmslM);
  return {
    validAt: source.validAt,
    wind: vertical.wind,
    lowerLevel: vertical.lowerLevel,
    upperLevel: vertical.upperLevel,
    verticalInterpolationRatio: vertical.ratio,
  };
}

function sampleWindColumn(
  column: OpenMeteoWindColumn,
  query: WindQuery,
): WindSample {
  const targetMs = Date.parse(query.validAt);
  const sortedSlices = column.slices;
  let beforeRaw: OpenMeteoWindColumnSlice | undefined;
  let afterRaw: OpenMeteoWindColumnSlice | undefined;

  for (const slice of sortedSlices) {
    const sliceMs = Date.parse(slice.validAt);
    if (sliceMs <= targetMs) beforeRaw = slice;
    if (sliceMs >= targetMs) {
      afterRaw = slice;
      break;
    }
  }

  if (!beforeRaw || !afterRaw) {
    throw new TrajectoryDomainError(
      "TIME_NOT_BRACKETED",
      "Open-Meteo ne fournit pas deux échéances encadrant l’heure demandée.",
    );
  }

  const before = buildSourceSlice(beforeRaw, query.altitudeAmslM);
  const after =
    afterRaw.validAt === beforeRaw.validAt
      ? before
      : buildSourceSlice(afterRaw, query.altitudeAmslM);
  const temporal = interpolateWindSlicesInTime(before, after, query.validAt);
  const sourceSlices = after === before ? [before] : [before, after];
  const warnings: string[] = [];

  if (sourceSlices.some((slice) => slice.lowerLevel !== slice.upperLevel)) {
    warnings.push(
      "Vent interpolé verticalement entre des niveaux météo encadrants.",
    );
  }
  if (after !== before) {
    warnings.push(
      "Vent interpolé temporellement entre deux échéances horaires.",
    );
  }
  if (
    Math.abs(column.sourceLatitude - query.latitude) > 1e-6 ||
    Math.abs(column.sourceLongitude - query.longitude) > 1e-6
  ) {
    warnings.push(
      "Open-Meteo a utilisé le point de grille météo associé aux coordonnées demandées.",
    );
  }

  return {
    query,
    wind: temporal.wind,
    sourceModel: column.sourceModel,
    sourceLatitude: column.sourceLatitude,
    sourceLongitude: column.sourceLongitude,
    sourceSlices,
    ...(after === before
      ? {}
      : {
          temporalInterpolation: {
            before: before.validAt,
            after: after.validAt,
            ratio: temporal.ratio,
          },
        }),
    warnings,
  };
}

export class OpenMeteoWindProvider implements WindProvider {
  private readonly client: OpenMeteoClient;
  private readonly terrainAltitudeAmslM?: number;

  constructor(client: OpenMeteoClient, terrainAltitudeAmslM?: number) {
    this.client = client;
    this.terrainAltitudeAmslM = terrainAltitudeAmslM;
  }

  async getWind(rawQuery: WindQuery) {
    const query = validateWindQuery(
      rawQuery,
      OPEN_METEO_WEATHER_MODELS,
    );
    if (!isSupportedModel(query.weatherModel)) {
      throw new TrajectoryDomainError(
        "UNSUPPORTED_WEATHER_MODEL",
        "Le modèle météo demandé n’est pas supporté par Open-Meteo.",
      );
    }

    const payload = await this.client.fetchWindColumn({
      latitude: query.latitude,
      longitude: query.longitude,
      validAt: query.validAt,
      weatherModel: query.weatherModel,
    });
    const column = parseOpenMeteoWindColumn(
      payload,
      query.weatherModel,
      this.terrainAltitudeAmslM,
    );
    column.slices.sort(
      (left, right) => Date.parse(left.validAt) - Date.parse(right.validAt),
    );
    return sampleWindColumn(column, query);
  }

  async prepareProjection(rawQuery: WindQuery): Promise<WindProvider> {
    const query = validateWindQuery(rawQuery, OPEN_METEO_WEATHER_MODELS);
    if (!isSupportedModel(query.weatherModel)) {
      throw new TrajectoryDomainError(
        "UNSUPPORTED_WEATHER_MODEL",
        "Le modèle météo demandé n’est pas supporté par Open-Meteo.",
      );
    }
    const payload = await this.client.fetchWindColumn({
      latitude: query.latitude,
      longitude: query.longitude,
      validAt: query.validAt,
      weatherModel: query.weatherModel,
    });
    const column = parseOpenMeteoWindColumn(
      payload,
      query.weatherModel,
      this.terrainAltitudeAmslM,
    );
    column.slices.sort(
      (left, right) => Date.parse(left.validAt) - Date.parse(right.validAt),
    );

    return {
      async getWind(rawLocalQuery: WindQuery) {
        const localQuery = validateWindQuery(
          rawLocalQuery,
          OPEN_METEO_WEATHER_MODELS,
        );
        if (
          localQuery.weatherModel !== query.weatherModel ||
          localQuery.latitude !== query.latitude ||
          localQuery.longitude !== query.longitude
        ) {
          throw new TrajectoryDomainError(
            "INVALID_PROVIDER_RESPONSE",
            "La session météo préparée ne correspond pas à la colonne de départ.",
          );
        }
        return sampleWindColumn(column, localQuery);
      },
    };
  }
}
