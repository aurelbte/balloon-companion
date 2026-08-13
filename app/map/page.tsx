"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Layers3,
  LocateFixed,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import PreparationMap from "../components/PreparationMap";
import AirspaceDetails from "../components/flight/AirspaceDetails";
import {
  Chip,
  FloatingAction,
  FloatingPanel,
} from "../design-system";
import { useSelectedAirspace } from "../hooks/useSelectedAirspace";
import { useBalloonRegistry } from "../hooks/useBalloons";
import {
  useAirspaceCoverage,
  type AirspaceCoverageViewport,
} from "../hooks/useAirspaceCoverage";
import { getAirspaceFrequencyPresentations } from "../lib/operationalFrequency";
import { loadPreparationDraft, savePreparationDraft } from "../lib/preparationDraftStorage";
import { buildLoadCalculationInput } from "../lib/loadPerformance/balloonInput";
import { calculateOfficialLoad } from "../lib/loadPerformance/engine";
import { displayLoadMarginKg, loadMarginTone } from "../lib/loadPerformance/engine";
import { calculateDemoLoad, DEMO_LOAD_BADGE } from "../lib/loadPerformance/demoEngine";
import { resolveLoadDemoMode, resolveSyntheticMarginMode } from "../lib/loadPerformance/demoMode";
import { loadDisplayPolicy } from "../lib/loadPerformance/loadDisplayMode";
import { loadCardBalloonCorrectionPath } from "../lib/loadPerformance/loadCardPolicy";
import { formatDemoLoadDiagnostic } from "../lib/loadPerformance/demoDiagnostic";
import { ApiElevationProvider } from "../lib/loadPerformance/elevationProvider";
import { GROUND_TEMPERATURE_PROVIDER_ID, OpenMeteoGroundTemperatureProvider, canFetchGroundTemperature, groundTemperatureRequestKey } from "../lib/loadPerformance/groundTemperatureProvider";
import type { GroundTemperature } from "../lib/loadPerformance/types";
import { balloonDisplayName } from "../lib/balloons";
import type { StoredFlightPreparationV2 } from "../lib/flightStorage";
import { selectIntersectedAirspaces } from "../lib/trajectoryAirspaces";
import {
  ALTITUDE_OPTIONS,
  altitudeKey,
  type AltitudeOption,
  type MultiAltitudeProjectionApiResponse,
  type MultiAltitudeProjectionRequest,
} from "../lib/trajectory/integration";
import {
  getTrajectoryAnalysisRequest,
  getTrajectoryProjectionV2,
  type StoredTrajectoryAnalysisRequest,
} from "../lib/trajectory/projectionStorage";
import {
  MODEL_LINE_STYLES,
} from "../lib/trajectory/analysisStyles";
import {
  newAnalysisLayerSettings,
  saveExportedPlannedTrajectories,
  type AnalysisLayerSettings,
  type ExportedPlannedTrajectory,
  type WeatherAnalysisState,
  type WeatherAnalysisTrace,
} from "../lib/trajectory/weatherAnalysisStorage";
import { WEATHER_MODEL_REGISTRY } from "../lib/weather/models";
import type { BaseMap } from "../types/flight";
import { createTrajectoryAnalysisKey, MAX_ANALYSIS_ALTITUDES, MAX_ANALYSIS_MODELS, toggleLimitedSelection } from "../lib/trajectory/analysisState";
import { metersPerSecondToMetersPerMinute } from "../lib/preparationInputs";

const ANALYSIS_ALTITUDE_OPTIONS = ALTITUDE_OPTIONS;
const REQUIRED_ANALYSIS_LAYERS: AnalysisLayerSettings = newAnalysisLayerSettings();

export default function MapPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<StoredTrajectoryAnalysisRequest | null>(
    null,
  );
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedAltitudes, setSelectedAltitudes] = useState<AltitudeOption[]>([]);
  const [layers, setLayers] = useState<AnalysisLayerSettings>(
    REQUIRED_ANALYSIS_LAYERS,
  );
  const [traces, setTraces] = useState<WeatherAnalysisTrace[]>([]);
  const [, setFailures] = useState<WeatherAnalysisState["failures"]>([]);
  const [visibleTraceIds, setVisibleTraceIds] = useState<string[]>([]);
  const [exportIds, setExportIds] = useState<string[]>([]);
  const [legendOpen, setLegendOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [selectorsVisible, setSelectorsVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedBalloonId, setSelectedBalloonId] = useState("");
  const [preparation, setPreparation] = useState<StoredFlightPreparationV2 | null>(null);
  const [maximumAltitudeInput, setMaximumAltitudeInput] = useState("");
  const [launchElevationMslM, setLaunchElevationMslM] = useState<number | null>(null);
  const [groundTemperatureState, setGroundTemperatureState] = useState<{ key: string; value: GroundTemperature & { fetchedAt: string } } | null>(null);
  const [groundTemperatureErrorCode, setGroundTemperatureErrorCode] = useState<string | null>(null);
  const [groundTemperaturePendingKey, setGroundTemperaturePendingKey] = useState<string | null>(null);
  const [temperatureDebugEnabled, setTemperatureDebugEnabled] = useState(false);
  const [profileDebugEnabled, setProfileDebugEnabled] = useState(false);
  const [testLoadEnabled, setTestLoadEnabled] = useState(false);
  const [showSyntheticMargin, setShowSyntheticMargin] = useState(false);
  const [loadDetailOpen, setLoadDetailOpen] = useState(false);
  const [viewport, setViewport] = useState<AirspaceCoverageViewport | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const signatureRef = useRef("");
  const desiredSignatureRef = useRef("");
  const [analysisSessionId, setAnalysisSessionId] = useState("");
  const [recenterToken, setRecenterToken] = useState(0);
  const satelliteAvailable = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim());
  const balloonRegistry = useBalloonRegistry();
  const {
    selectedAirspaces,
    selectedAirspace,
    selectedIndex,
    selectAirspaces,
    selectPrevious,
    selectNext,
    closeSelection,
  } = useSelectedAirspace(null, null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const analysisRequest = getTrajectoryAnalysisRequest();
      setAnalysisSessionId(`analysis-${Date.now()}`);
      const demoEnabled = resolveLoadDemoMode(window.location.search);
      setTestLoadEnabled(demoEnabled);
      setShowSyntheticMargin(resolveSyntheticMarginMode(window.location.search, demoEnabled));
      setTemperatureDebugEnabled(process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("debugTemp") === "1");
      setProfileDebugEnabled(process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("debugProfile") === "1");
      const preparation = loadPreparationDraft();
      const legacyProjection = getTrajectoryProjectionV2();
      const stored =
        analysisRequest ??
        (legacyProjection
          ? {
              version: 1 as const,
              updatedAtIso: legacyProjection.createdAtIso,
              request: legacyProjection.request,
            }
          : null);
      setConfig(stored);
      setSelectedBalloonId(preparation?.balloonName ?? "");
      setPreparation(preparation);
      setMaximumAltitudeInput(
        preparation?.targetAltitudeAmslM === null || preparation?.targetAltitudeAmslM === undefined
          ? ""
          : String(preparation.targetAltitudeAmslM),
      );
      if (stored) {
        setSelectedModels([]);
        setSelectedAltitudes([]);
        setTraces([]);
        setFailures([]);
        setVisibleTraceIds([]);
        setLayers(newAnalysisLayerSettings());
        signatureRef.current = "";
        desiredSignatureRef.current = "";
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!config) return;
    let active = true;
    const provider = new ApiElevationProvider();
    void provider.getElevation(config.request.launchSite)
      .then(({ elevationMslM }) => { if (active) setLaunchElevationMslM(elevationMslM); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [config]);

  useEffect(() => {
    const launchSite = config?.request.launchSite ?? preparation?.launchSite;
    const dateTime = config?.request.launchDateTimeIso ?? preparation?.departureTime;
    if (!launchSite || !dateTime) return;
    const requestIdentity = {
      latitude: launchSite.latitude,
      longitude: launchSite.longitude,
      dateTime,
      provider: GROUND_TEMPERATURE_PROVIDER_ID,
    };
    if (!canFetchGroundTemperature(requestIdentity)) return;
    let active = true;
    const controller = new AbortController();
    const key = groundTemperatureRequestKey(requestIdentity);
    const provider = new OpenMeteoGroundTemperatureProvider();
    const fetchTemperature = async () => {
      await Promise.resolve();
      if (!active) return;
      setGroundTemperaturePendingKey(key);
      setGroundTemperatureErrorCode(null);
      try {
        const value = await provider.getGroundTemperature({ ...requestIdentity, weatherModel: GROUND_TEMPERATURE_PROVIDER_ID, signal: controller.signal });
        if (active) { setGroundTemperatureState({ key, value }); setGroundTemperaturePendingKey(null); setGroundTemperatureErrorCode(null); }
      } catch (error) {
        if (active && !controller.signal.aborted) { setGroundTemperaturePendingKey(null); setGroundTemperatureErrorCode(error instanceof Error ? error.name : "INVALID_OPEN_METEO_RESPONSE"); }
      }
    };
    void fetchTemperature();
    return () => { active = false; controller.abort(); };
  }, [config, preparation]);

  useEffect(() => {
    if (!ready || !config) return;
    if (selectedModels.length === 0 || selectedAltitudes.length === 0) {
      requestAbortRef.current?.abort();
      signatureRef.current = "";
      desiredSignatureRef.current = "";
      return;
    }
    const signature = createTrajectoryAnalysisKey(config.request, selectedModels, selectedAltitudes);
    desiredSignatureRef.current = signature;
    if (signature === signatureRef.current) return;
    const controller = new AbortController();
    requestAbortRef.current?.abort();
    requestAbortRef.current = controller;
    signatureRef.current = "";
    setTraces([]);
    setVisibleTraceIds([]);
    setFailures([]);
    setLoading(true);
    setNotice(null);
    const timer = window.setTimeout(async () => {
      const calculatedAtIso = new Date().toISOString();
      const results = await Promise.all(
        selectedModels.map(async (modelId) => {
          const model = WEATHER_MODEL_REGISTRY.find((item) => item.id === modelId);
          if (!model?.supported) return null;
          const request: MultiAltitudeProjectionRequest = {
            version: 2,
            launchSite: config.request.launchSite,
            launchDateTimeIso: config.request.launchDateTimeIso,
            durationSeconds: config.request.durationSeconds,
            weatherModel: model.providerModelId,
            altitudesAmslM: selectedAltitudes,
            ...(config.request.climbRateMps === undefined ? {} : { climbRateMps: config.request.climbRateMps }),
            ...(config.request.descentRateMps === undefined ? {} : { descentRateMps: config.request.descentRateMps }),
          };
          try {
            const response = await fetch("/api/trajectory/project", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(request),
              signal: controller.signal,
            });
            const payload =
              (await response.json()) as MultiAltitudeProjectionApiResponse;
            return { model, payload };
          } catch (error) {
            if (controller.signal.aborted) return null;
            return {
              model,
              payload: {
                ok: false as const,
                error: {
                  code: "NETWORK_UNAVAILABLE",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Réseau indisponible",
                },
              },
            };
          }
        }),
      );
      if (controller.signal.aborted || desiredSignatureRef.current !== signature) return;
      const nextTraces = results.flatMap((result) =>
        result?.payload.ok
          ? result.payload.layerProjections.map((trace) => ({
              ...trace,
              ...(result.payload.ok &&
              result.payload.flightProfileProjection &&
              trace.altitudeAmslM === config.request.primaryAltitudeAmslM
                ? { projection: result.payload.flightProfileProjection }
                : {}),
              traceId: `${result.model.id}:${trace.altitudeKey}`,
              model: result.model,
              calculatedAtIso,
              forecastAtIso: config.request.launchDateTimeIso,
            }))
          : [],
      );
      const nextFailures = results.flatMap((result) => {
        if (!result) return [];
        if (!result.payload.ok) {
          return [
            {
              modelId: result.model.id,
              altitudeKey: "all",
              code: result.payload.error.code,
              message: result.payload.error.message,
            },
          ];
        }
        return result.payload.failures.map((failure) => ({
          ...failure,
          modelId: result.model.id,
        }));
      });
      if (nextTraces.length > 0) {
        setTraces(nextTraces);
        setVisibleTraceIds(nextTraces.map((trace) => trace.traceId));
        setExportIds((current) =>
          current.filter((id) =>
            nextTraces.some((trace) => trace.traceId === id),
          ),
        );
        signatureRef.current = signature;
        const verticalProfileFailure = nextFailures.find(
          (failure) =>
            failure.code === "INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE",
        );
        if (verticalProfileFailure) {
          setNotice("Profil vertical impossible avec cette durée.");
          if (process.env.NODE_ENV === "development") {
            console.debug("[vertical-profile]", verticalProfileFailure.details);
          }
        }
      } else {
        setNotice(
          navigator.onLine
            ? nextFailures[0]?.code ===
              "INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE"
              ? "Profil vertical impossible avec cette durée."
              : nextFailures[0]?.message ?? "Aucune trajectoire exploitable pour cette sélection."
            : "Hors ligne — dernières trajectoires conservées.",
        );
      }
      if (desiredSignatureRef.current === signature) {
        setFailures(nextFailures);
        setLoading(false);
      }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [config, ready, selectedAltitudes, selectedModels]);

  const airspaceCoverage = useAirspaceCoverage({
    position: null,
    isPositionStale: true,
    viewport,
    explorationEnabled: layers.airspaces,
  });
  const displayedTraces = useMemo(
    () =>
      traces.filter(
        (trace) =>
          selectedModels.includes(trace.model.id) &&
          selectedAltitudes.some(
            (altitude) => altitudeKey(altitude) === trace.altitudeKey,
          ),
      ),
    [selectedAltitudes, selectedModels, traces],
  );
  const intersectedAirspaces = useMemo(
    () =>
      selectIntersectedAirspaces(
        displayedTraces,
        airspaceCoverage.airspaces,
      ),
    [airspaceCoverage.airspaces, displayedTraces],
  );
  const selectedAirspaceFrequencies = useMemo(
    () =>
      selectedAirspace
        ? getAirspaceFrequencyPresentations(selectedAirspace, null)
        : [],
    [selectedAirspace],
  );
  const selectedBalloon = balloonRegistry.balloons.find(({ id }) => id === selectedBalloonId);
  const plannedMaximumAltitudeMslM = maximumAltitudeInput.trim() === "" ? undefined : Number(maximumAltitudeInput);
  const temperatureLaunchSite = config?.request.launchSite ?? preparation?.launchSite;
  const temperatureDateTime = config?.request.launchDateTimeIso ?? preparation?.departureTime;
  const groundTemperatureRequest = temperatureLaunchSite && temperatureDateTime ? { latitude: temperatureLaunchSite.latitude, longitude: temperatureLaunchSite.longitude, dateTime: temperatureDateTime, provider: GROUND_TEMPERATURE_PROVIDER_ID } : null;
  const groundTemperatureFetchEnabled = groundTemperatureRequest !== null && canFetchGroundTemperature(groundTemperatureRequest);
  const groundTemperatureKey = groundTemperatureRequest ? groundTemperatureRequestKey(groundTemperatureRequest) : "";
  const groundTemperature = groundTemperatureState?.key === groundTemperatureKey ? groundTemperatureState.value : null;
  const groundTemperatureLoading = groundTemperatureFetchEnabled && groundTemperaturePendingKey === groundTemperatureKey;
  const loadInput = buildLoadCalculationInput({
    balloon: selectedBalloon,
    occupantsWeightKg: preparation?.occupantsWeightKg,
    launchLatitude: config?.request.launchSite.latitude,
    launchLongitude: config?.request.launchSite.longitude,
    launchElevationMslM: launchElevationMslM ?? undefined,
    launchDateTime: config?.request.launchDateTimeIso,
    plannedMaximumAltitudeMslM,
    groundTemperature: groundTemperature ?? undefined,
  });
  const loadResult = testLoadEnabled
    ? calculateDemoLoad(loadInput, true)
    : calculateOfficialLoad(loadInput);
  const loadDisplay = loadDisplayPolicy({
    demoEnabled: testLoadEnabled,
    syntheticMarginRequested: showSyntheticMargin,
    resultAvailable: loadResult.status === "AVAILABLE",
  });
  const candidateLoadResult = loadResult.status === "AVAILABLE" && "calculationStatus" in loadResult
    && loadResult.calculationStatus === "CANDIDATE_PILOT_VALIDATION" ? loadResult : null;
  const displayedMargin = loadResult.status === "AVAILABLE" && (!testLoadEnabled || loadDisplay.showSyntheticMargin)
    ? displayLoadMarginKg(loadResult.marginKg)
    : null;
  const marginTone = displayedMargin === null ? null : loadMarginTone(displayedMargin);
  const marginColor = marginTone === "positive" ? "#37c978" : marginTone === "caution" ? "#f59e0b" : marginTone === "negative" ? "#ef4444" : "var(--bc-color-text-muted)";
  const heightAboveTerrainM = plannedMaximumAltitudeMslM !== undefined && launchElevationMslM !== null
    ? plannedMaximumAltitudeMslM - launchElevationMslM
    : null;
  const maximumAltitudeBelowTerrain = heightAboveTerrainM !== null && heightAboveTerrainM < 0;
  const demoDiagnostic = `${formatDemoLoadDiagnostic({
    terrain: launchElevationMslM !== null,
    temperature: Boolean(groundTemperature),
    balloon: Boolean(selectedBalloon),
    occupantsWeight: typeof preparation?.occupantsWeightKg === "number" && preparation.occupantsWeightKg > 0,
    maximumAltitude: typeof plannedMaximumAltitudeMslM === "number" && Number.isFinite(plannedMaximumAltitudeMslM),
  })}${!groundTemperature && groundTemperatureErrorCode ? ` · ${groundTemperatureErrorCode}` : ""}`;
  const blockingMessage = testLoadEnabled
    ? loadResult.status === "AVAILABLE"
      ? "Flux technique validé"
      : loadResult.reasonCode
    : loadResult.status === "AVAILABLE"
      ? null
      : ({
    NO_BALLOON: "Ballon non sélectionné",
    INCOMPLETE_BALLOON_MASSES: "Complétez les masses du ballon",
    NO_OCCUPANTS_WEIGHT: "Renseignez Pilote + passagers",
    NO_MAXIMUM_ALTITUDE: "Saisissez l’altitude maximale",
    NO_LAUNCH_ELEVATION: "Altitude terrain indisponible",
    NO_GROUND_TEMPERATURE: groundTemperatureLoading ? "Température sol : récupération…" : "Température au sol indisponible",
    UNSUPPORTED_MODEL: "Modèle non pris en charge",
    UNSUPPORTED_OFFICIAL_DATASET: "Données constructeur non encore intégrées",
    OUTSIDE_OFFICIAL_TABLE: loadResult.message,
    OUTSIDE_DEMO_TABLE: loadResult.message,
    MISSING_MTOW: "MTOM non renseignée",
    CONFIGURATION_LIMIT_MISSING: "Limite de configuration indisponible",
    CONFIGURATION_LIMITS_UNCONFIRMED: "Limites du ballon non confirmées",
    VOLUME_MISMATCH: "Volume incompatible avec le modèle",
    PENDING_VERIFICATION: "Paramètres constructeur en attente de validation",
    } as const)[loadResult.reasonCode] ?? "Calcul impossible";
  const unavailableLoadCardCopy = loadResult.status === "UNAVAILABLE" ? ({
    NO_BALLOON: ["Ballon", "à sélectionner"],
    INCOMPLETE_BALLOON_MASSES: ["Masses du ballon", "à compléter"],
    NO_OCCUPANTS_WEIGHT: ["Pilote + passagers", "à renseigner"],
    NO_MAXIMUM_ALTITUDE: ["Altitude maximale", "à renseigner"],
    NO_LAUNCH_ELEVATION: ["Altitude terrain", "indisponible"],
    NO_GROUND_TEMPERATURE: ["Température sol", groundTemperatureLoading ? "récupération…" : "indisponible"],
    UNSUPPORTED_MODEL: ["Modèle", "non pris en charge"],
    UNSUPPORTED_OFFICIAL_DATASET: ["Données constructeur", "non intégrées"],
    OUTSIDE_OFFICIAL_TABLE: ["Conditions", "hors domaine"],
    OUTSIDE_DEMO_TABLE: ["Conditions test", "hors domaine"],
    MISSING_MTOW: ["MTOM", "à renseigner"],
    CONFIGURATION_LIMIT_MISSING: ["Limite du ballon", "indisponible"],
    CONFIGURATION_LIMITS_UNCONFIRMED: ["Limites du ballon", "à confirmer"],
    VOLUME_MISMATCH: ["Volume du ballon", "à vérifier"],
    PENDING_VERIFICATION: ["Paramètres constructeur", "en attente"],
  } as const)[loadResult.reasonCode] : null;

  const openLoadCard = () => {
    const correctionPath = !testLoadEnabled ? loadCardBalloonCorrectionPath(selectedBalloon?.id, loadResult) : null;
    if (correctionPath) {
      router.push(correctionPath);
      return;
    }
    if ((testLoadEnabled && loadDisplay.openSyntheticDetail) || (!testLoadEnabled && loadResult.status === "AVAILABLE")) setLoadDetailOpen(true);
  };

  const updateMaximumAltitude = (value: string) => {
    const digits = value.replace(/\D/g, "");
    setMaximumAltitudeInput(digits);
    if (!preparation) return;
    const altitude = digits === "" ? null : Number(digits);
    const next = { ...preparation, targetAltitudeAmslM: altitude, updatedAt: Date.now() };
    setPreparation(next);
    savePreparationDraft(next);
  };

  const toggleModel = (modelId: string) => {
    const result = toggleLimitedSelection({ current: selectedModels, value: modelId, maximum: MAX_ANALYSIS_MODELS, minimum: 0 });
    if (result.limitReached) setNotice("Maximum 3 modèles simultanés.");
    setSelectedModels(result.values);
    if (result.values.length === 0 || selectedAltitudes.length === 0) {
      requestAbortRef.current?.abort();
      setTraces([]);
      setVisibleTraceIds([]);
      setFailures([]);
      setLoading(false);
      setNotice(null);
    }
  };
  const toggleAltitude = (altitude: AltitudeOption) => {
    const result = toggleLimitedSelection({ current: selectedAltitudes, value: altitude, maximum: MAX_ANALYSIS_ALTITUDES, minimum: 0 });
    if (result.limitReached) setNotice("Maximum 5 altitudes simultanées.");
    const values = ALTITUDE_OPTIONS.filter((option) => result.values.includes(option));
    setSelectedAltitudes(values);
    if (values.length === 0 || selectedModels.length === 0) {
      requestAbortRef.current?.abort();
      setTraces([]);
      setVisibleTraceIds([]);
      setFailures([]);
      setLoading(false);
      setNotice(null);
    }
  };
  const handleMapPress = () => {
    setLegendOpen(false);
    setDisplayOpen(false);
  };
  const updateDisplay = (
    key: "satellite" | "airspaces",
    value: boolean,
  ) => {
    setLayers((current) => ({ ...current, [key]: value }));
    if (key === "airspaces" && !value) closeSelection();
  };
  const exportToFlight = () => {
    const exports: ExportedPlannedTrajectory[] = displayedTraces
      .filter((trace) => exportIds.includes(trace.traceId))
      .map((trace) => ({
        version: 1,
        traceId: trace.traceId,
        modelId: trace.model.id,
        modelLabel: trace.model.label,
        providerModelId: trace.model.providerModelId,
        altitudeKey: trace.altitudeKey,
        altitudeAmslM: trace.altitudeAmslM,
        altitudeLabel: trace.label,
        color: trace.color,
        dasharray: MODEL_LINE_STYLES[trace.model.id].dasharray,
        geometry: trace.projection.points.map((point) => [
          point.longitude,
          point.latitude,
        ]),
        calculatedAtIso: trace.calculatedAtIso,
        forecastAtIso: trace.forecastAtIso,
        ...(trace.projection.points[0]?.windUsed
          ? {
              predictedWind: {
                directionFromDeg: trace.projection.points[0].windUsed.directionFromDeg,
                speedMps: trace.projection.points[0].windUsed.speedMps,
              },
            }
          : {}),
      }));
    if (saveExportedPlannedTrajectories(exports)) {
      setNotice(
        `${exports.length} trajectoire${exports.length > 1 ? "s" : ""} disponible${exports.length > 1 ? "s" : ""} en Vol.`,
      );
    }
  };

  if (!ready) {
    return <main className="flex h-dvh items-center justify-center">Chargement…</main>;
  }
  if (!config) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-black">Préparation nécessaire</h1>
        <p>Renseignez les paramètres du vol avant d’ouvrir l’analyse météo.</p>
        <button
          type="button"
          onClick={() => router.push("/prepare")}
          className="min-h-12 rounded-xl bg-[var(--bc-accent)] px-5 font-black"
        >
          Revenir à Prépa
        </button>
      </main>
    );
  }

  const baseMap: BaseMap =
    layers.satellite && satelliteAvailable ? "satellite" : "plan";
  const launchSiteShortName =
    config.request.launchSite.name.split(",")[0]?.trim() ||
    config.request.launchSite.name;

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[var(--bc-color-canvas)]">
      <header
        className="sticky top-0 z-40 border-b px-3 pb-1 pt-[max(4px,env(safe-area-inset-top))]"
        style={{
          background: "var(--bc-color-canvas-elevated)",
          borderColor: "var(--bc-border)",
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/prepare")}
            className="flex min-h-9 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs font-semibold"
            style={{ color: "var(--bc-accent)" }}
            aria-label="Revenir à la préparation"
          >
            <ArrowLeft size={17} />
            Préparation
          </button>
          <div
            className="min-w-0 border-l pl-2.5"
            style={{ borderColor: "var(--bc-border)" }}
          >
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {launchSiteShortName}
            </h1>
            <span className="sr-only">Analyse des trajectoires</span>
          </div>
        </div>
      </header>

      <div className="relative h-[clamp(430px,68dvh,700px)]">
          <PreparationMap
            traces={displayedTraces}
            visibleTraceIds={visibleTraceIds}
            launchSiteName={config.request.launchSite.name}
            launchSite={config.request.launchSite}
            analysisKey={`${analysisSessionId}:${createTrajectoryAnalysisKey(config.request, selectedModels, selectedAltitudes)}`}
            baseMap={baseMap}
            layers={layers}
            recenterToken={recenterToken}
            airspaces={airspaceCoverage.airspaces}
            onAirspacesSelected={selectAirspaces}
            onMapPress={handleMapPress}
            onViewportChange={setViewport}
          />
        {displayedTraces.length === 0 && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-16 text-center text-sm font-semibold text-white/80">{loading ? "Calcul des trajectoires…" : selectedModels.length === 0 || selectedAltitudes.length === 0 ? "Sélectionnez un modèle et une altitude." : "Aucune trajectoire disponible"}</div>}
        {profileDebugEnabled && (
          <div className="pointer-events-none absolute bottom-2 left-2 z-40 rounded-lg bg-black/80 px-2 py-1 text-[9px] font-semibold text-white">
            <div>Montée : +{(config.request.climbRateMps ?? 0).toFixed(1).replace(".", ",")} m/s → {metersPerSecondToMetersPerMinute(config.request.climbRateMps ?? 0)} m/min</div>
            <div>Descente : −{(config.request.descentRateMps ?? 0).toFixed(1).replace(".", ",")} m/s → {metersPerSecondToMetersPerMinute(config.request.descentRateMps ?? 0)} m/min</div>
          </div>
        )}

        <FloatingAction
          onClick={() => setSelectorsVisible((value) => !value)}
          className="absolute left-3 top-3 z-30 rounded-full"
          aria-label={
            selectorsVisible
              ? "Masquer les sélecteurs latéraux"
              : "Afficher les sélecteurs latéraux"
          }
          aria-pressed={!selectorsVisible}
        >
          {selectorsVisible ? (
            <PanelLeftClose size={20} />
          ) : (
            <PanelLeftOpen size={20} />
          )}
        </FloatingAction>

        {selectorsVisible && (
          <aside
            aria-label="Modèles météo"
            className="absolute left-2 top-1/2 z-20 grid -translate-y-1/2 gap-0.5"
          >
            {WEATHER_MODEL_REGISTRY.filter((model) => model.supported).map(
              (model) => {
                const selected = selectedModels.includes(model.id);
                const selectionOrder = selectedModels.indexOf(model.id);
                return (
                  <Chip
                    key={model.id}
                    selected={selected}
                    onClick={() => toggleModel(model.id)}
                    disabled={!selected && selectedModels.length >= MAX_ANALYSIS_MODELS}
                    className="!min-h-[22px] w-fit max-w-[68px] !justify-start !px-1.5 !py-0 text-[8px] font-bold"
                    style={{
                      borderStyle:
                        selectionOrder === 1 ? "dashed" : "solid",
                      borderWidth:
                        selectionOrder === 1 ? "2px" : selected ? "1.5px" : "1px",
                    }}
                  >
                    <span>{model.label}</span>
                  </Chip>
                );
              },
            )}
          </aside>
        )}

        {selectorsVisible && (
          <aside
            aria-label="Altitudes"
            className="absolute right-2 top-1/2 z-20 grid -translate-y-1/2 gap-0.5"
          >
            {ANALYSIS_ALTITUDE_OPTIONS.map((altitude) => {
              const selected = selectedAltitudes.includes(altitude);
              const color =
                displayedTraces.find(
                  (trace) => trace.altitudeKey === altitudeKey(altitude),
                )?.color ?? "var(--bc-color-cloud)";
              return (
                <Chip
                  key={String(altitude)}
                  selected={selected}
                  onClick={() => toggleAltitude(altitude)}
                  disabled={!selected && selectedAltitudes.length >= MAX_ANALYSIS_ALTITUDES}
                  className="!min-h-[22px] w-[38px] !px-0.5 !py-0 text-[9px] font-bold"
                  style={{
                    borderColor: selected
                      ? color
                      : "rgb(255 255 255 / 16%)",
                    color: selected ? color : "rgb(255 255 255 / 78%)",
                  }}
                >
                  {altitude === "ground" ? "Sol" : altitude}
                </Chip>
              );
            })}
          </aside>
        )}

        <div className="absolute right-3 top-3 z-30">
          <FloatingAction
            onClick={() => {
              setLegendOpen(false);
              setDisplayOpen((value) => !value);
            }}
            aria-label="Couches de la carte"
            aria-expanded={displayOpen}
          >
            <Layers3 size={19} />
          </FloatingAction>
          {displayOpen && (
            <FloatingPanel className="absolute right-0 mt-2 w-48 text-white">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-white/55">Fond de carte</p>
              <label className="flex min-h-10 items-center justify-between gap-3 text-xs font-semibold">
                Carte classique
                <input type="radio" name="analysis-base-map" checked={baseMap === "plan"} onChange={() => updateDisplay("satellite", false)} className="h-5 w-5 accent-[var(--bc-color-action)]" />
              </label>
              <label className="flex min-h-10 items-center justify-between gap-3 text-xs font-semibold">
                Satellite
                <input type="radio" name="analysis-base-map" checked={baseMap === "satellite"} disabled={!satelliteAvailable} onChange={() => updateDisplay("satellite", true)} className="h-5 w-5 accent-[var(--bc-color-action)]" />
              </label>
              <p className="mb-1 mt-2 border-t border-white/10 pt-2 text-[9px] font-semibold uppercase tracking-wider text-white/55">Superposition</p>
              <label className="flex min-h-10 items-center justify-between gap-3 text-xs font-semibold">
                Espaces aériens
                <input
                  type="checkbox"
                  checked={layers.airspaces}
                  onChange={(event) =>
                    updateDisplay("airspaces", event.target.checked)
                  }
                  className="h-5 w-5 accent-[var(--bc-color-action)]"
                />
              </label>
            </FloatingPanel>
          )}
        </div>

        <FloatingAction onClick={() => setRecenterToken((value) => value + 1)} className="absolute right-3 top-16 z-20 rounded-full" aria-label="Recentrer les trajectoires"><LocateFixed size={18} /></FloatingAction>

      <section className="absolute bottom-[max(6px,env(safe-area-inset-bottom))] left-3 z-20 w-[min(316px,calc(100vw-72px))] rounded-[var(--bc-radius-dock)] border border-white/20 bg-[var(--bc-color-surface-glass)] text-white shadow-[var(--bc-shadow-high)] backdrop-blur-md">
        <button
          type="button"
          onClick={() => {
            setDisplayOpen(false);
            setLegendOpen((value) => !value);
          }}
          className="flex min-h-10 w-full items-center gap-2 px-3 text-[11px] font-semibold"
        >
          <Navigation size={15} style={{ color: "var(--bc-accent)" }} />
          <span>Utiliser cette analyse en Vol</span>
          <span className="flex-1" />
        </button>
        {legendOpen && (
          <div className="grid max-h-[34vh] gap-2 overflow-y-auto rounded-b-[var(--bc-radius-control)] border-t border-white/15 bg-[var(--bc-color-surface-glass)] p-2.5">
            <div>
              <div className="grid grid-cols-2 gap-1">
                {displayedTraces.map((trace) => (
                  <label
                    key={trace.traceId}
                    className="flex min-h-9 items-center gap-1.5 rounded-lg bg-white/5 px-2 text-[9px] font-bold"
                  >
                    <input
                      type="checkbox"
                      checked={exportIds.includes(trace.traceId)}
                      onChange={() =>
                        setExportIds((current) =>
                          current.includes(trace.traceId)
                            ? current.filter((id) => id !== trace.traceId)
                            : [...current, trace.traceId],
                        )
                      }
                      className="h-4 w-4"
                    />
                    <span style={{ color: trace.color }}>●</span>
                    {trace.model.label} {trace.label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                disabled={exportIds.length === 0}
                onClick={exportToFlight}
                className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--bc-accent)] text-xs font-black text-[var(--bc-accent-foreground)] disabled:opacity-45"
              >
                <Download size={16} /> Conserver en Vol
              </button>
            </div>
          </div>
        )}
      </section>

      {(notice || loading) && (
        <p className="absolute left-1/2 top-[max(14px,env(safe-area-inset-top))] z-40 -translate-x-1/2 rounded-full border border-white/20 bg-[var(--bc-color-surface-glass)] px-3 py-2 text-[10px] font-bold text-white shadow-[var(--bc-shadow-low)]">
          {loading ? "Mise à jour météo…" : notice}
        </p>
      )}
      </div>

      <section
        className="relative z-30 border-t px-3 py-2.5"
        style={{
          background: "var(--bc-color-canvas-elevated)",
          borderColor: "var(--bc-border)",
        }}
        aria-label="Paramètres des trajectoires"
      >
        <div className="mx-auto max-w-3xl">
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            <div
              role="button"
              tabIndex={0}
              onClick={openLoadCard}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openLoadCard(); }}
              className="min-h-[118px] rounded-[16px] border p-2.5 text-left transition-transform active:scale-[0.98]"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                boxShadow: "var(--bc-shadow-xs)",
              }}
            >
              <h2
                className="text-[10px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                Charge
              </h2>
              {loadDisplay.showSyntheticBadge && <span className="mt-1 inline-block rounded bg-orange-600 px-1.5 py-0.5 text-[8px] font-black tracking-wider text-white">{DEMO_LOAD_BADGE} — DONNÉES SYNTHÉTIQUES</span>}
              {!testLoadEnabled && candidateLoadResult && <span className="mt-0.5 block text-[9px] font-semibold text-[var(--bc-color-text-muted)]">Validation pilote</span>}
              {!testLoadEnabled && loadResult.status === "UNAVAILABLE" && unavailableLoadCardCopy && <div className="mt-0.5 leading-tight"><p className="text-[11px] font-semibold">{unavailableLoadCardCopy[0]}</p><p className="text-[10px] text-[var(--bc-color-text-muted)]">{unavailableLoadCardCopy[1]}</p></div>}
              {(!testLoadEnabled && displayedMargin !== null) && <p className="mt-0.5 text-xl font-semibold tracking-tight" style={{ color: marginColor }} aria-label={`Marge de charge ${displayedMargin} kilogrammes`}>{`${displayedMargin >= 0 ? "+" : "−"}${Math.abs(displayedMargin)} kg`}</p>}
              {testLoadEnabled && <p className={`${displayedMargin === null ? "text-sm leading-tight" : "text-2xl"} mt-1 font-semibold tracking-tight`} style={{ color: marginColor }} aria-label={blockingMessage ?? `Marge de charge ${displayedMargin} kilogrammes`}>{blockingMessage ?? `${displayedMargin! >= 0 ? "+" : "−"}${Math.abs(displayedMargin!)} kg`}</p>}
              {testLoadEnabled && loadResult.status === "AVAILABLE" && !loadDisplay.showSyntheticMargin && <p className="mt-1 text-[9px] font-semibold leading-tight text-[var(--bc-color-text-muted)]">Dataset officiel Cameron requis</p>}
              {testLoadEnabled && <p className="mt-1 whitespace-nowrap text-[8px] font-semibold tracking-tight text-[var(--bc-color-text-muted)]">{demoDiagnostic}</p>}
              {testLoadEnabled && loadResult.status === "UNAVAILABLE" && (
                <dl className="mt-1 space-y-0.5 text-[8px] leading-tight text-[var(--bc-color-text-muted)]">
                  <div><dt className="inline">constructeur : </dt><dd className="inline">{loadInput.manufacturer ?? "—"}</dd></div>
                  <div><dt className="inline">modèle : </dt><dd className="inline">{loadInput.model ?? "—"}</dd></div>
                  <div><dt className="inline">masse ballon : </dt><dd className="inline">{loadInput.balloonEquipmentWeightKg === undefined ? "—" : `${loadInput.balloonEquipmentWeightKg} kg`}</dd></div>
                  <div><dt className="inline">MTOM : </dt><dd className="inline">{loadInput.applicableMtowKg === undefined ? "—" : `${loadInput.applicableMtowKg} kg`}</dd></div>
                  <div><dt className="inline">pilote + passagers : </dt><dd className="inline">{loadInput.occupantsWeightKg === undefined ? "—" : `${loadInput.occupantsWeightKg} kg`}</dd></div>
                  <div><dt className="inline">altitude terrain : </dt><dd className="inline">{loadInput.launchElevationMslM === undefined ? "—" : `${loadInput.launchElevationMslM} m AMSL`}</dd></div>
                  <div><dt className="inline">altitude maximale : </dt><dd className="inline">{loadInput.plannedMaximumAltitudeMslM === undefined ? "—" : `${loadInput.plannedMaximumAltitudeMslM} m AMSL`}</dd></div>
                  <div><dt className="inline">température : </dt><dd className="inline">{loadInput.groundTemperature === undefined ? "—" : `${loadInput.groundTemperature.temperatureC} °C`}</dd></div>
                  <div><dt className="inline">mode DEMO : </dt><dd className="inline">{testLoadEnabled ? "ON" : "OFF"}</dd></div>
                </dl>
              )}
              {temperatureDebugEnabled && <div className="mt-1 text-[8px] font-semibold leading-tight text-[var(--bc-color-text-muted)]"><p>TEMP FETCH : {groundTemperatureFetchEnabled ? "ON" : "OFF"}</p><p>TEMP VALUE : {groundTemperature ? groundTemperature.temperatureC.toLocaleString("fr-FR") : "—"}</p><p>TEMP ERROR : {groundTemperatureErrorCode ?? "—"}</p></div>}
              <label className="mt-1.5 block">
                <span className="block text-[9px] font-semibold leading-tight">Altitude max</span>
                <span className="mt-0.5 flex items-center gap-1">
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={maximumAltitudeInput} onClick={(event) => event.stopPropagation()} onChange={(event) => updateMaximumAltitude(event.target.value)} placeholder="Ex. 1500" aria-label="Altitude maximale prévue en mètres AMSL" aria-invalid={maximumAltitudeBelowTerrain} className="min-w-0 w-full rounded-lg border bg-black/10 px-1.5 py-1 text-sm font-semibold outline-none focus:border-[var(--bc-accent)]" style={{ borderColor: maximumAltitudeBelowTerrain ? "#ef4444" : "var(--bc-border)" }} />
                  <span className="shrink-0 text-[9px]" style={{ color: "var(--bc-color-text-muted)" }}>m AMSL</span>
                </span>
              </label>
              {maximumAltitudeBelowTerrain && <p className="mt-0.5 text-[8px] font-semibold leading-tight text-red-500">Sous l’altitude terrain</p>}
            </div>

            <button
              type="button"
              onClick={() => {
                if (intersectedAirspaces.length > 0) {
                  selectAirspaces(intersectedAirspaces);
                } else {
                  setNotice("Aucun espace intersecté par les trajectoires.");
                }
              }}
              className="min-h-[118px] rounded-[16px] border p-2.5 text-left transition-transform active:scale-[0.98]"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                boxShadow: "var(--bc-shadow-xs)",
              }}
            >
              <h2
                className="text-[10px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                Espaces
              </h2>
              <p className="mt-4 text-2xl font-semibold tracking-tight">
                {airspaceCoverage.visibleLoading
                  ? "…"
                  : `${intersectedAirspaces.length}`}
              </p>
            </button>

            <button
              type="button"
              onClick={() => setNotice("Information NOTAM indisponible.")}
              className="min-h-[118px] rounded-[16px] border p-2.5 text-left transition-transform active:scale-[0.98]"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                boxShadow: "var(--bc-shadow-xs)",
              }}
            >
              <h2
                className="text-[10px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                NOTAM
              </h2>
              <p
                className="mt-4 text-2xl font-semibold tracking-tight"
                style={{ color: "var(--bc-color-text-muted)" }}
                aria-label="Nombre de NOTAM indisponible"
              >
                —
              </p>
            </button>
          </div>
        </div>
      </section>

      {selectedAirspace && (
        <AirspaceDetails
          airspace={selectedAirspace}
          currentIndex={selectedIndex}
          totalCount={selectedAirspaces.length}
          onPrevious={selectPrevious}
          onNext={selectNext}
          onClose={closeSelection}
          frequencies={selectedAirspaceFrequencies}
        />
      )}
      {loadDetailOpen && !testLoadEnabled && candidateLoadResult && selectedBalloon && groundTemperature && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/45" onClick={() => setLoadDetailOpen(false)}>
          <section className="w-full rounded-t-[24px] border border-white/10 bg-[var(--bc-color-canvas-elevated)] p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl" onClick={(event) => event.stopPropagation()} aria-label="Détail du calcul de charge Cameron">
            <div className="mx-auto max-w-xl">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Charge</h2><p className="text-xs text-[var(--bc-color-text-muted)]">Validation pilote</p></div><button type="button" className="min-h-11 min-w-11 rounded-full" onClick={() => setLoadDetailOpen(false)} aria-label="Fermer"><X className="mx-auto" size={20} /></button></div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2"><dt className="text-xs text-[var(--bc-color-text-muted)]">Ballon</dt><dd>{selectedBalloon.manufacturer} {selectedBalloon.model}<br />{selectedBalloon.registration}</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Poids du ballon équipé</dt><dd>{loadInput.balloonEquipmentWeightKg} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Pilote + passagers</dt><dd>{loadInput.occupantsWeightKg} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Masse réelle</dt><dd>{Math.floor(candidateLoadResult.actualTotalMassKg)} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Altitude terrain</dt><dd>{Math.round(candidateLoadResult.launchElevationMslM)} m AMSL</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Altitude maximale prévue</dt><dd>{Math.round(candidateLoadResult.maximumAltitudeMslM)} m AMSL</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Température au sol</dt><dd>{candidateLoadResult.groundTemperatureC.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} °C</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Capacité maximale Pilote + passagers</dt><dd>{Math.floor(candidateLoadResult.availableOccupantsCapacityKg)} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Masse totale autorisée</dt><dd>{Math.floor(candidateLoadResult.permittedTotalMassKg)} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">MTOM applicable</dt><dd>{loadInput.applicableMtowKg} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Marge disponible</dt><dd style={{ color: marginColor }}>{displayedMargin! >= 0 ? "+" : "−"}{Math.abs(displayedMargin!)} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Règle limitante</dt><dd>{candidateLoadResult.limitingRule === "APPLICABLE_MTOW" ? "MTOM applicable" : "Performance selon conditions"}</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Méthode</dt><dd>Cameron A2-1</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Source</dt><dd>HABFM Issue 10 — Amendment 18</dd></div>
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-[var(--bc-color-text-muted)]">Calcul fondé sur la méthode constructeur référencée et les informations enregistrées pour ce ballon. Vérifiez les limitations et la configuration avec le manuel de vol applicable.</p>
            </div>
          </section>
        </div>
      )}
      {loadDetailOpen && loadDisplay.openSyntheticDetail && loadResult.status === "AVAILABLE" && selectedBalloon && groundTemperature && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/45" onClick={() => setLoadDetailOpen(false)}>
          <section className="w-full rounded-t-[24px] border border-white/10 bg-[var(--bc-color-canvas-elevated)] p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl" onClick={(event) => event.stopPropagation()} aria-label="Détail du calcul de charge de démonstration">
            <div className="mx-auto max-w-xl">
              <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-black text-orange-400">TEST — DONNÉES SYNTHÉTIQUES</h2><button type="button" className="min-h-11 min-w-11 rounded-full" onClick={() => setLoadDetailOpen(false)} aria-label="Fermer"><X className="mx-auto" size={20} /></button></div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2"><dt className="text-xs text-[var(--bc-color-text-muted)]">Ballon</dt><dd>{balloonDisplayName(selectedBalloon)}</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Poids du ballon équipé</dt><dd>{loadInput.balloonEquipmentWeightKg} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Pilote + passagers</dt><dd>{loadInput.occupantsWeightKg} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Masse réelle</dt><dd>{Math.round(loadResult.actualTotalMassKg)} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Altitude terrain</dt><dd>{Math.round(loadResult.launchElevationMslM)} m AMSL</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Altitude maximale prévue</dt><dd>{Math.round(loadInput.plannedMaximumAltitudeMslM!)} m AMSL</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Température utilisée</dt><dd>{Math.round(loadResult.groundTemperatureC)} °C</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Masse autorisée de démonstration</dt><dd>{Math.floor(loadResult.permittedTotalMassKg)} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Marge de démonstration</dt><dd style={{ color: marginColor }}>{displayedMargin! >= 0 ? "+" : "−"}{Math.abs(displayedMargin!)} kg</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Prévision</dt><dd>{new Date(groundTemperature.validTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</dd></div>
                <div><dt className="text-xs text-[var(--bc-color-text-muted)]">Décalage</dt><dd>{(groundTemperature.forecastOffsetMinutes ?? 0) >= 0 ? "+" : "−"}{Math.abs(Math.round(groundTemperature.forecastOffsetMinutes ?? 0))} min</dd></div>
                <div className="col-span-2"><dt className="text-xs text-[var(--bc-color-text-muted)]">Source</dt><dd>{groundTemperature.provider ?? "Open-Meteo"} · {groundTemperature.sourceModel}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-[var(--bc-color-text-muted)]">Dataset</dt><dd>Données synthétiques pour test UX</dd></div>
              </dl>
              <p className="mt-4 text-xs leading-relaxed text-[var(--bc-color-text-muted)]">Calcul de démonstration — non utilisable pour la préparation réelle d’un vol. Ce résultat sert uniquement à vérifier le fonctionnement de l’interface. Il ne reproduit pas encore la table officielle du manuel de vol.</p>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
