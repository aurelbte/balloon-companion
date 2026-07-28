export type WeatherModelId =
  | "gfs"
  | "arome"
  | "icon"
  | "arome-hd"
  | "ecmwf"
  | "icon-d2"
  | "arpege";

export type WeatherModelDefinition = {
  id: WeatherModelId;
  label: string;
  provider: "Open-Meteo";
  providerModelId: string;
  geographicCoverage: "global" | "regional";
  regionDescription?: string;
  supported: boolean;
  unsupportedReason?: string;
  supportsNearSurfaceWind: boolean;
  supportsPressureLevels: boolean;
  supportsGeopotentialHeight: boolean;
  maximumForecastHours?: number;
  resolutionDescription: string;
  runFrequencyDescription: string;
};

/**
 * Registre unique des modèles proposés par Balloon Companion.
 *
 * Les capacités ont été vérifiées par une requête fournisseur réelle à
 * Bondues. `supported` signifie que la chaîne technique sait exploiter le
 * modèle, pas qu'une échéance ou une coordonnée donnée sera toujours couverte.
 */
export const WEATHER_MODEL_REGISTRY: readonly WeatherModelDefinition[] = [
  {
    id: "gfs",
    label: "GFS",
    provider: "Open-Meteo",
    providerModelId: "gfs_seamless",
    geographicCoverage: "global",
    supported: true,
    supportsNearSurfaceWind: true,
    supportsPressureLevels: true,
    supportsGeopotentialHeight: true,
    maximumForecastHours: 384,
    resolutionDescription: "Global, environ 0,11° à 0,25° selon échéance",
    runFrequencyDescription: "4 mises à jour par jour",
  },
  {
    id: "arome",
    label: "AROME",
    provider: "Open-Meteo",
    providerModelId: "arome_seamless",
    geographicCoverage: "regional",
    regionDescription: "France métropolitaine et abords",
    supported: true,
    supportsNearSurfaceWind: true,
    supportsPressureLevels: true,
    supportsGeopotentialHeight: true,
    maximumForecastHours: 51,
    resolutionDescription: "France, assemblage AROME haute résolution",
    runFrequencyDescription: "Plusieurs mises à jour par jour",
  },
  {
    id: "icon",
    label: "ICON",
    provider: "Open-Meteo",
    providerModelId: "icon_seamless",
    geographicCoverage: "global",
    supported: true,
    supportsNearSurfaceWind: true,
    supportsPressureLevels: true,
    supportsGeopotentialHeight: true,
    maximumForecastHours: 180,
    resolutionDescription: "Assemblage ICON global et régional",
    runFrequencyDescription: "4 mises à jour par jour",
  },
  {
    id: "arome-hd",
    label: "AROME HD",
    provider: "Open-Meteo",
    providerModelId: "meteofrance_arome_france_hd",
    geographicCoverage: "regional",
    regionDescription: "France métropolitaine",
    supported: false,
    unsupportedReason:
      "Les niveaux verticaux nécessaires sont incomplets lors du test de bout en bout à Bondues.",
    supportsNearSurfaceWind: true,
    supportsPressureLevels: false,
    supportsGeopotentialHeight: false,
    maximumForecastHours: 42,
    resolutionDescription: "France, environ 1,5 km",
    runFrequencyDescription: "Plusieurs mises à jour par jour",
  },
  {
    id: "ecmwf",
    label: "ECMWF",
    provider: "Open-Meteo",
    providerModelId: "ecmwf_ifs025",
    geographicCoverage: "global",
    supported: true,
    supportsNearSurfaceWind: true,
    supportsPressureLevels: true,
    supportsGeopotentialHeight: true,
    maximumForecastHours: 360,
    resolutionDescription: "Global, environ 0,25°",
    runFrequencyDescription: "4 mises à jour par jour",
  },
  {
    id: "icon-d2",
    label: "ICON-D2",
    provider: "Open-Meteo",
    providerModelId: "icon_d2",
    geographicCoverage: "regional",
    regionDescription: "Europe centrale, couverture à vérifier au point choisi",
    supported: true,
    supportsNearSurfaceWind: true,
    supportsPressureLevels: true,
    supportsGeopotentialHeight: true,
    maximumForecastHours: 48,
    resolutionDescription: "Europe centrale, environ 2 km",
    runFrequencyDescription: "8 mises à jour par jour",
  },
  {
    id: "arpege",
    label: "ARPEGE",
    provider: "Open-Meteo",
    providerModelId: "arpege_seamless",
    geographicCoverage: "global",
    supported: true,
    supportsNearSurfaceWind: true,
    supportsPressureLevels: true,
    supportsGeopotentialHeight: true,
    maximumForecastHours: 102,
    resolutionDescription: "Global, grille Météo-France assemblée",
    runFrequencyDescription: "4 mises à jour par jour",
  },
] as const;

export const SUPPORTED_WEATHER_MODELS = WEATHER_MODEL_REGISTRY.filter(
  (model) => model.supported,
);

export function weatherModelByProviderId(
  providerModelId: string,
): WeatherModelDefinition | undefined {
  return WEATHER_MODEL_REGISTRY.find(
    (model) => model.providerModelId === providerModelId,
  );
}
