"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Layers3,
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
import { balloonEquipmentWeightForLoad } from "../lib/loadPerformance/balloonInput";
import { calculateOfficialLoad } from "../lib/loadPerformance/engine";
import { displayLoadMarginKg, loadMarginTone } from "../lib/loadPerformance/engine";
import { calculateDemoLoad, DEMO_LOAD_BADGE } from "../lib/loadPerformance/demoEngine";
import { resolveLoadDemoMode } from "../lib/loadPerformance/demoMode";
import { formatDemoLoadDiagnostic } from "../lib/loadPerformance/demoDiagnostic";
import { ApiElevationProvider } from "../lib/loadPerformance/elevationProvider";
import { OpenMeteoGroundTemperatureProvider } from "../lib/loadPerformance/groundTemperatureProvider";
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
  DEFAULT_ANALYSIS_LAYERS,
  loadWeatherAnalysis,
  saveExportedPlannedTrajectories,
  saveWeatherAnalysis,
  type AnalysisLayerSettings,
  type ExportedPlannedTrajectory,
  type WeatherAnalysisState,
  type WeatherAnalysisTrace,
} from "../lib/trajectory/weatherAnalysisStorage";
import { WEATHER_MODEL_REGISTRY } from "../lib/weather/models";
import type { BaseMap } from "../types/flight";

const MAX_MODELS = 2;
const MAX_ALTITUDES = 4;
const ANALYSIS_ALTITUDE_OPTIONS = ALTITUDE_OPTIONS.filter(
  (altitude) => altitude !== 2500,
);
const REQUIRED_ANALYSIS_LAYERS: AnalysisLayerSettings = {
  ...DEFAULT_ANALYSIS_LAYERS,
  trajectories: true,
  airspaces: true,
  aeronauticalMap: false,
  timeMarkers: true,
  arrivalMarkers: true,
};

function analysisSignature(
  models: readonly string[],
  altitudes: readonly AltitudeOption[],
  request: MultiAltitudeProjectionRequest,
) {
  return [
    [...models].sort().join(","),
    altitudes.join(","),
    request.launchSite.latitude,
    request.launchSite.longitude,
    request.launchDateTimeIso,
    request.durationSeconds,
  ].join("|");
}

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
  const [failures, setFailures] = useState<WeatherAnalysisState["failures"]>([]);
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
  const [groundTemperatureError, setGroundTemperatureError] = useState<string | null>(null);
  const [testLoadEnabled, setTestLoadEnabled] = useState(false);
  const [loadDetailOpen, setLoadDetailOpen] = useState(false);
  const [viewport, setViewport] = useState<AirspaceCoverageViewport | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const signatureRef = useRef("");
  const satelliteAvailable = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim());
  const balloonRegistry = useBalloonRegistry();
  const {
    selectedAirspaces,
    selectedAirspace,
    selectedIndex,
    verticalContext,
    selectAirspaces,
    selectPrevious,
    selectNext,
    closeSelection,
  } = useSelectedAirspace(null, null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const analysisRequest = getTrajectoryAnalysisRequest();
      setTestLoadEnabled(resolveLoadDemoMode(window.location.search));
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
      const cached = loadWeatherAnalysis();
      setConfig(stored);
      setSelectedBalloonId(preparation?.balloonName ?? "");
      setPreparation(preparation);
      setMaximumAltitudeInput(
        preparation?.targetAltitudeAmslM === null || preparation?.targetAltitudeAmslM === undefined
          ? ""
          : String(preparation.targetAltitudeAmslM),
      );
      if (stored) {
        const defaultModel =
          WEATHER_MODEL_REGISTRY.find(
            (model) =>
              model.providerModelId === stored.request.weatherModel,
          )?.id ?? "arome";
        const models = cached?.selectedModelIds.length
          ? cached.selectedModelIds
          : [defaultModel];
        const altitudes = (
          cached?.selectedAltitudes.length
            ? cached.selectedAltitudes
            : stored.request.altitudesAmslM
        )
          .filter((altitude) => altitude !== 2500)
          .slice(0, MAX_ALTITUDES);
        setSelectedModels(models.slice(0, MAX_MODELS));
        setSelectedAltitudes(altitudes);
        if (cached) {
          setLayers({
            ...cached.layers,
            trajectories: true,
            aeronauticalMap: false,
            timeMarkers: true,
            arrivalMarkers: true,
          });
          setTraces(cached.traces);
          setFailures(cached.failures);
          setVisibleTraceIds(cached.traces.map((trace) => trace.traceId));
          if (cached.traces.length > 0) {
            const cachedDuration =
              cached.traces[0]?.projection.points.at(-1)?.elapsedSeconds;
            const cacheMatchesRequest =
              cached.traces.every(
                (trace) =>
                  trace.forecastAtIso === stored.request.launchDateTimeIso,
              ) && cachedDuration === stored.request.durationSeconds;
            if (cacheMatchesRequest) {
              signatureRef.current = analysisSignature(
                models,
                altitudes,
                stored.request,
              );
            }
          }
        }
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
    if (!testLoadEnabled || !config) return;
    let active = true;
    const key = JSON.stringify([config.request.launchSite.latitude, config.request.launchSite.longitude, config.request.launchDateTimeIso, config.request.weatherModel]);
    const provider = new OpenMeteoGroundTemperatureProvider();
    void provider.getGroundTemperature({
      latitude: config.request.launchSite.latitude,
      longitude: config.request.launchSite.longitude,
      dateTime: config.request.launchDateTimeIso,
      weatherModel: config.request.weatherModel,
    }).then((value) => { if (active) { setGroundTemperatureState({ key, value }); setGroundTemperatureError(null); } })
      .catch((error) => { if (active) setGroundTemperatureError(error instanceof Error ? error.message : "Température au sol indisponible"); });
    return () => { active = false; };
  }, [config, testLoadEnabled]);

  useEffect(() => {
    if (
      !ready ||
      !config ||
      selectedModels.length === 0 ||
      selectedAltitudes.length === 0
    )
      return;
    const signature = analysisSignature(
      selectedModels,
      selectedAltitudes,
      config.request,
    );
    if (signature === signatureRef.current) return;
    const controller = new AbortController();
    requestAbortRef.current?.abort();
    requestAbortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setNotice(null);
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
      if (controller.signal.aborted) return;
      const nextTraces = results.flatMap((result) =>
        result?.payload.ok
          ? result.payload.layerProjections.map((trace) => ({
              ...trace,
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
      } else {
        setNotice(
          navigator.onLine
            ? "Aucune trajectoire exploitable pour cette sélection."
            : "Hors ligne — dernières trajectoires conservées.",
        );
      }
      setFailures(nextFailures);
      setLoading(false);
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [config, ready, selectedAltitudes, selectedModels]);

  useEffect(() => {
    if (!ready || !config) return;
    const timer = window.setTimeout(() => {
      saveWeatherAnalysis({
        version: 1,
        updatedAtIso: new Date().toISOString(),
        selectedModelIds: selectedModels,
        selectedAltitudes,
        layers,
        traces,
        failures,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [config, failures, layers, ready, selectedAltitudes, selectedModels, traces]);

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
  const groundTemperatureKey = config ? JSON.stringify([config.request.launchSite.latitude, config.request.launchSite.longitude, config.request.launchDateTimeIso, config.request.weatherModel]) : "";
  const groundTemperature = groundTemperatureState?.key === groundTemperatureKey ? groundTemperatureState.value : null;
  const groundTemperatureLoading = testLoadEnabled && Boolean(config) && groundTemperatureState?.key !== groundTemperatureKey;
  const loadInput = {
    ...(selectedBalloon ? {
      balloonId: selectedBalloon.id,
      manufacturer: selectedBalloon.manufacturer,
      model: selectedBalloon.model,
      volumeM3: selectedBalloon.volumeM3,
      balloonEquipmentWeightKg: balloonEquipmentWeightForLoad(selectedBalloon) ?? undefined,
    } : {}),
    occupantsWeightKg: preparation?.occupantsWeightKg,
    launchLatitude: config?.request.launchSite.latitude,
    launchLongitude: config?.request.launchSite.longitude,
    launchElevationMslM: launchElevationMslM ?? undefined,
    launchDateTime: config?.request.launchDateTimeIso,
    plannedMaximumAltitudeMslM,
    groundTemperature: groundTemperature ?? undefined,
  };
  const loadResult = testLoadEnabled
    ? calculateDemoLoad(loadInput, true)
    : calculateOfficialLoad(loadInput);
  const displayedMargin = loadResult.status === "AVAILABLE" ? displayLoadMarginKg(loadResult.marginKg) : null;
  const marginTone = displayedMargin === null ? null : loadMarginTone(displayedMargin);
  const marginColor = marginTone === "positive" ? "#37c978" : marginTone === "caution" ? "#f59e0b" : marginTone === "negative" ? "#ef4444" : "var(--bc-color-text-muted)";
  const heightAboveTerrainM = plannedMaximumAltitudeMslM !== undefined && launchElevationMslM !== null
    ? plannedMaximumAltitudeMslM - launchElevationMslM
    : null;
  const maximumAltitudeBelowTerrain = heightAboveTerrainM !== null && heightAboveTerrainM < 0;
  const demoDiagnostic = formatDemoLoadDiagnostic({
    terrain: launchElevationMslM !== null,
    temperature: Boolean(groundTemperature),
    balloon: Boolean(selectedBalloon),
    occupantsWeight: typeof preparation?.occupantsWeightKg === "number" && preparation.occupantsWeightKg > 0,
    maximumAltitude: typeof plannedMaximumAltitudeMslM === "number" && Number.isFinite(plannedMaximumAltitudeMslM),
  });
  const blockingMessage = loadResult.status === "AVAILABLE" ? null : ({
    NO_BALLOON: "Ballon non sélectionné",
    INCOMPLETE_BALLOON_MASSES: "Complétez les masses du ballon",
    NO_OCCUPANTS_WEIGHT: "Renseignez Pilote + passagers",
    NO_MAXIMUM_ALTITUDE: "Saisissez l’altitude maximale",
    NO_LAUNCH_ELEVATION: "Altitude terrain indisponible",
    NO_GROUND_TEMPERATURE: groundTemperatureLoading ? "Température sol : récupération…" : "Température au sol indisponible",
    UNSUPPORTED_MODEL: "Modèle DEMO non pris en charge",
    UNSUPPORTED_OFFICIAL_DATASET: "Calcul impossible",
    OUTSIDE_OFFICIAL_TABLE: loadResult.message,
    OUTSIDE_DEMO_TABLE: loadResult.message,
    MISSING_MTOW: "Calcul impossible",
    CONFIGURATION_LIMIT_MISSING: "Calcul impossible",
  } as const)[loadResult.reasonCode] ?? "Calcul impossible";

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
    setSelectedModels((current) => {
      if (current.includes(modelId))
        return current.length === 1
          ? current
          : current.filter((item) => item !== modelId);
      if (current.length >= MAX_MODELS) {
        setNotice("Maximum 2 modèles simultanés.");
        return current;
      }
      return [...current, modelId];
    });
  };
  const toggleAltitude = (altitude: AltitudeOption) => {
    setSelectedAltitudes((current) => {
      if (current.includes(altitude))
        return current.length === 1
          ? current
          : current.filter((item) => item !== altitude);
      if (current.length >= MAX_ALTITUDES) {
        setNotice("Maximum 4 altitudes simultanées.");
        return current;
      }
      return ALTITUDE_OPTIONS.filter(
        (option) => current.includes(option) || option === altitude,
      );
    });
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

      <div className="relative h-[clamp(460px,74dvh,760px)]">
        {displayedTraces.length > 0 ? (
          <PreparationMap
            traces={displayedTraces}
            visibleTraceIds={visibleTraceIds}
            launchSiteName={config.request.launchSite.name}
            baseMap={baseMap}
            layers={layers}
            airspaces={airspaceCoverage.airspaces}
            onAirspacesSelected={selectAirspaces}
            onMapPress={handleMapPress}
            onViewportChange={setViewport}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-bold text-white/70">
            {loading ? "Calcul des trajectoires…" : "Aucune trajectoire disponible"}
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
              <label className="flex min-h-10 items-center justify-between gap-3 text-xs font-semibold">
                Vue satellite
                <input
                  type="checkbox"
                  checked={layers.satellite && satelliteAvailable}
                  disabled={!satelliteAvailable}
                  onChange={(event) =>
                    updateDisplay("satellite", event.target.checked)
                  }
                  className="h-5 w-5 accent-[var(--bc-color-action)]"
                />
              </label>
              <label
                className="flex min-h-10 items-center justify-between gap-3 text-xs font-semibold opacity-45"
                title="Relief bientôt disponible"
              >
                Relief
                <input
                  type="checkbox"
                  disabled
                  className="h-5 w-5"
                />
              </label>
            </FloatingPanel>
          )}
        </div>

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
        className="relative z-30 border-t px-3 py-5"
        style={{
          background: "var(--bc-color-canvas-elevated)",
          borderColor: "var(--bc-border)",
        }}
        aria-label="Paramètres des trajectoires"
      >
        <div className="mx-auto max-w-3xl">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => { if (loadResult.status === "AVAILABLE") setLoadDetailOpen(true); }}
              onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && loadResult.status === "AVAILABLE") setLoadDetailOpen(true); }}
              className="min-h-28 rounded-[20px] border p-3 text-left transition-transform active:scale-[0.98]"
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
              {testLoadEnabled && loadResult.status === "AVAILABLE" && <span className="mt-1 inline-block rounded px-1.5 py-0.5 text-[8px] font-black tracking-wider text-white" style={{ background: marginColor }}>{DEMO_LOAD_BADGE}</span>}
              <p className={`${displayedMargin === null ? "text-sm leading-tight" : "text-2xl"} mt-1 font-semibold tracking-tight`} style={{ color: marginColor }} aria-label={blockingMessage ?? `Marge de charge ${displayedMargin} kilogrammes`}>
                {blockingMessage ?? `${displayedMargin! >= 0 ? "+" : "−"}${Math.abs(displayedMargin!)} kg`}
              </p>
              {testLoadEnabled && <p className="mt-1 whitespace-nowrap text-[8px] font-semibold tracking-tight text-[var(--bc-color-text-muted)]">{demoDiagnostic}</p>}
              <label className="mt-2 block">
                <span className="block text-[10px] font-semibold leading-tight">Altitude maximale prévue</span>
                <span className="mt-1 flex items-center gap-1">
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={maximumAltitudeInput} onClick={(event) => event.stopPropagation()} onChange={(event) => updateMaximumAltitude(event.target.value)} placeholder="Ex. 1500" aria-label="Altitude maximale prévue en mètres AMSL" aria-invalid={maximumAltitudeBelowTerrain} className="min-w-0 w-full rounded-lg border bg-black/10 px-2 py-1.5 text-base font-semibold outline-none focus:border-[var(--bc-accent)]" style={{ borderColor: maximumAltitudeBelowTerrain ? "#ef4444" : "var(--bc-border)" }} />
                  <span className="shrink-0 text-[9px]" style={{ color: "var(--bc-color-text-muted)" }}>m AMSL</span>
                </span>
              </label>
              <div className="mt-1.5 space-y-0.5 text-[9px] leading-tight" style={{ color: "var(--bc-color-text-muted)" }}>
                <p>Terrain : {launchElevationMslM === null ? "récupération…" : `${Math.round(launchElevationMslM)} m AMSL`}</p>
                {heightAboveTerrainM !== null && heightAboveTerrainM >= 0 && <p>Hauteur prévue : {Math.round(heightAboveTerrainM).toLocaleString("fr-FR")} m</p>}
                {maximumAltitudeBelowTerrain && <p className="font-semibold text-red-500">L’altitude prévue est inférieure à l’altitude du terrain.</p>}
                {!maximumAltitudeBelowTerrain && maximumAltitudeInput === "" && <p>Altitude maximale requise.</p>}
                {!maximumAltitudeBelowTerrain && maximumAltitudeInput !== "" && !groundTemperatureLoading && groundTemperatureError && <p title={groundTemperatureError}>Température au sol indisponible</p>}
              </div>
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
              className="min-h-28 rounded-[20px] border p-3 text-left transition-transform active:scale-[0.98]"
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
              className="min-h-28 rounded-[20px] border p-3 text-left transition-transform active:scale-[0.98]"
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

      {selectedAirspace && verticalContext && (
        <AirspaceDetails
          airspace={selectedAirspace}
          verticalContext={verticalContext}
          currentIndex={selectedIndex}
          totalCount={selectedAirspaces.length}
          onPrevious={selectPrevious}
          onNext={selectNext}
          onClose={closeSelection}
          frequencies={selectedAirspaceFrequencies}
        />
      )}
      {loadDetailOpen && testLoadEnabled && loadResult.status === "AVAILABLE" && selectedBalloon && groundTemperature && (
        <div className="fixed inset-0 z-[80] flex items-end bg-black/45" onClick={() => setLoadDetailOpen(false)}>
          <section className="w-full rounded-t-[24px] border border-white/10 bg-[var(--bc-color-canvas-elevated)] p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl" onClick={(event) => event.stopPropagation()} aria-label="Détail du calcul de charge de démonstration">
            <div className="mx-auto max-w-xl">
              <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-black text-orange-400">TEST — NON OPÉRATIONNEL</h2><button type="button" className="min-h-11 min-w-11 rounded-full" onClick={() => setLoadDetailOpen(false)} aria-label="Fermer"><X className="mx-auto" size={20} /></button></div>
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
