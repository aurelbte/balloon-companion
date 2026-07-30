"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  LocateFixed,
  Maximize2,
  PanelLeftOpen,
} from "lucide-react";
import PreparationMap from "../components/PreparationMap";
import AirspaceDetails from "../components/flight/AirspaceDetails";
import {
  Chip,
  FloatingAction,
  FloatingPanel,
} from "../design-system";
import { useSelectedAirspace } from "../hooks/useSelectedAirspace";
import {
  useAirspaceCoverage,
  type AirspaceCoverageViewport,
} from "../hooks/useAirspaceCoverage";
import { getAirspaceFrequencyPresentations } from "../lib/operationalFrequency";
import { getFlightPreparation } from "../lib/flightStorage";
import {
  ALTITUDE_OPTIONS,
  altitudeKey,
  altitudeLabel,
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
import {
  WEATHER_MODEL_REGISTRY,
  type WeatherModelDefinition,
} from "../lib/weather/models";
import type { BaseMap } from "../types/flight";

const MAX_MODELS = 2;
const MAX_ALTITUDES = 4;
const REQUIRED_ANALYSIS_LAYERS: AnalysisLayerSettings = {
  ...DEFAULT_ANALYSIS_LAYERS,
  trajectories: true,
  airspaces: true,
  aeronauticalMap: false,
  timeMarkers: true,
  arrivalMarkers: true,
};

function analysisSignature(models: readonly string[], altitudes: readonly AltitudeOption[]) {
  return `${[...models].sort().join(",")}|${altitudes.join(",")}`;
}

function ModelLinePreview({ model }: { model: WeatherModelDefinition }) {
  const style = MODEL_LINE_STYLES[model.id];
  return (
    <svg aria-hidden="true" width="48" height="8" viewBox="0 0 48 8">
      <line
        x1="1"
        y1="4"
        x2="47"
        y2="4"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={style.dasharray.join(" ")}
      />
    </svg>
  );
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
  const [recenterToken, setRecenterToken] = useState(0);
  const [passengerWeightKg, setPassengerWeightKg] = useState<number | null>(
    null,
  );
  const [viewport, setViewport] = useState<AirspaceCoverageViewport | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const signatureRef = useRef("");
  const satelliteAvailable = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim());
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
      const preparation = getFlightPreparation();
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
      setPassengerWeightKg(preparation?.passengerWeightKg ?? null);
      if (stored) {
        const defaultModel =
          WEATHER_MODEL_REGISTRY.find(
            (model) =>
              model.providerModelId === stored.request.weatherModel,
          )?.id ?? "arome";
        const models = cached?.selectedModelIds.length
          ? cached.selectedModelIds
          : [defaultModel];
        const altitudes = cached?.selectedAltitudes.length
          ? cached.selectedAltitudes.slice(0, MAX_ALTITUDES)
          : stored.request.altitudesAmslM.slice(0, MAX_ALTITUDES);
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
            signatureRef.current = analysisSignature(models, altitudes);
          }
        }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (
      !ready ||
      !config ||
      selectedModels.length === 0 ||
      selectedAltitudes.length === 0
    )
      return;
    const signature = analysisSignature(selectedModels, selectedAltitudes);
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
  const selectedAirspaceFrequencies = useMemo(
    () =>
      selectedAirspace
        ? getAirspaceFrequencyPresentations(selectedAirspace, null)
        : [],
    [selectedAirspace],
  );

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
  const highestSelectedAltitude = selectedAltitudes.reduce<number | null>(
    (highest, altitude) =>
      typeof altitude === "number" && (highest === null || altitude > highest)
        ? altitude
        : highest,
    null,
  );

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[var(--bc-color-canvas)]">
      <header
        className="sticky top-0 z-40 border-b px-3 pb-3 pt-[max(10px,env(safe-area-inset-top))]"
        style={{
          background: "var(--bc-color-canvas-elevated)",
          borderColor: "var(--bc-border)",
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/prepare")}
            className="flex min-h-11 shrink-0 items-center gap-1 rounded-full px-2 text-sm font-semibold"
            style={{ color: "var(--bc-accent)" }}
            aria-label="Revenir à la préparation"
          >
            <ArrowLeft size={19} />
            Préparation
          </button>
          <div className="min-w-0 border-l pl-3" style={{ borderColor: "var(--bc-border)" }}>
            <p
              className="text-[9px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--bc-color-text-muted)" }}
            >
              {config.request.launchSite.name}
            </p>
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Analyse des trajectoires
            </h1>
          </div>
        </div>
      </header>

      <div className="relative h-[clamp(430px,68dvh,720px)]">
        {displayedTraces.length > 0 ? (
          <PreparationMap
            traces={displayedTraces}
            visibleTraceIds={visibleTraceIds}
            launchSiteName={config.request.launchSite.name}
            baseMap={baseMap}
            layers={layers}
            airspaces={airspaceCoverage.airspaces}
            recenterToken={recenterToken}
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
              ? "Afficher uniquement la carte"
              : "Restaurer les sélecteurs"
          }
          aria-pressed={!selectorsVisible}
        >
          {selectorsVisible ? (
            <Maximize2 size={21} />
          ) : (
            <PanelLeftOpen size={21} />
          )}
        </FloatingAction>

        {selectorsVisible && (
          <aside
            aria-label="Modèles météo"
            className="absolute left-2 top-[72px] z-20 grid gap-1"
          >
            {WEATHER_MODEL_REGISTRY.filter((model) => model.supported).map(
              (model) => {
                const selected = selectedModels.includes(model.id);
                return (
                  <Chip
                    key={model.id}
                    selected={selected}
                    onClick={() => toggleModel(model.id)}
                    className="w-[98px] justify-between text-[9px] font-bold"
                  >
                    <span>{model.label}</span>
                    <span className="scale-[0.65]">
                      <ModelLinePreview model={model} />
                    </span>
                  </Chip>
                );
              },
            )}
          </aside>
        )}

        {selectorsVisible && (
          <aside
            aria-label="Altitudes"
            className="absolute right-2 top-[72px] z-20 grid gap-1"
          >
            {ALTITUDE_OPTIONS.map((altitude) => {
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
                  className="min-w-[58px] text-[9px] font-bold"
                  style={{
                    borderColor: selected
                      ? color
                      : "rgb(255 255 255 / 16%)",
                    color: selected ? color : "rgb(255 255 255 / 78%)",
                  }}
                >
                  {altitudeLabel(altitude)}
                </Chip>
              );
            })}
          </aside>
        )}

      <div className="absolute right-3 top-[max(12px,env(safe-area-inset-top))] z-30">
        <Chip
          onClick={() => {
            setLegendOpen(false);
            setDisplayOpen((value) => !value);
          }}
          selected={displayOpen}
          className="text-[10px] font-bold"
          aria-expanded={displayOpen}
        >
          🗺️ Affichage
        </Chip>
        {displayOpen && (
          <FloatingPanel className="mt-2 w-44 text-white">
            <label className="flex min-h-10 items-center justify-between gap-2 text-xs font-bold">
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
            <label className="flex min-h-10 items-center justify-between gap-2 text-xs font-bold">
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

      <FloatingAction
        onClick={() => setRecenterToken((value) => value + 1)}
        className="absolute bottom-[max(96px,calc(82px+env(safe-area-inset-bottom)))] right-3 z-20"
        aria-label="Recentrer toutes les trajectoires"
      >
        <LocateFixed size={20} />
      </FloatingAction>

      <section className="absolute bottom-[max(6px,env(safe-area-inset-bottom))] left-3 z-20 w-[min(316px,calc(100vw-72px))] rounded-[var(--bc-radius-dock)] border border-white/20 bg-[var(--bc-color-surface-glass)] text-white shadow-[var(--bc-shadow-high)] backdrop-blur-md">
        <button
          type="button"
          onClick={() => {
            setDisplayOpen(false);
            setLegendOpen((value) => !value);
          }}
          className="flex min-h-9 w-full items-center gap-2 px-2.5 text-[10px] font-black"
        >
          <span>{displayedTraces.length} trajectoires</span>
          <span className="flex flex-1 items-center gap-1 overflow-hidden">
            {selectedModels.map((modelId) => {
              const model = WEATHER_MODEL_REGISTRY.find(
                (item) => item.id === modelId,
              );
              return model ? (
                <span key={model.id} className="scale-75">
                  <ModelLinePreview model={model} />
                </span>
              ) : null;
            })}
            {selectedAltitudes.map((altitude) => {
              const color =
                displayedTraces.find(
                  (trace) => trace.altitudeKey === altitudeKey(altitude),
                )?.color ?? "white";
              return (
                <span key={String(altitude)} style={{ color }}>
                  ●
                </span>
              );
            })}
          </span>
          <span>{legendOpen ? "−" : "+"}</span>
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
          <div className="grid gap-4">
            <article
              className="rounded-[28px] border p-5"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                boxShadow: "var(--bc-shadow-xs)",
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: "var(--bc-color-text-muted)" }}
                  >
                    Charge
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    Courbe de charge
                  </h2>
                </div>
                <span
                  className="rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.1em]"
                  style={{
                    borderColor: "var(--bc-border)",
                    color: "var(--bc-color-text-muted)",
                  }}
                >
                  {highestSelectedAltitude === null
                    ? "Sol"
                    : `${highestSelectedAltitude} m`}
                </span>
              </div>
              <div
                className="mt-5 h-3 overflow-hidden rounded-full border"
                style={{
                  background: "rgb(255 255 255 / 4%)",
                  borderColor: "var(--bc-border)",
                }}
                aria-label="Charge embarquée"
              >
                <div
                  className="h-full w-full opacity-20"
                  style={{
                    background:
                      "repeating-linear-gradient(90deg, var(--bc-accent) 0 2px, transparent 2px 8px)",
                  }}
                />
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-4">
                <p className="text-xl font-semibold">
                  {passengerWeightKg === null
                    ? "Poids non renseigné"
                    : `${passengerWeightKg.toLocaleString("fr-FR")} kg`}
                </p>
                <p
                  className="text-right text-xs"
                  style={{ color: "var(--bc-color-text-muted)" }}
                >
                  Passagers
                </p>
              </div>
              <div
                className="mt-4 border-t pt-4"
                style={{ borderColor: "var(--bc-border)" }}
              >
                <p className="text-sm font-semibold">
                  Marge disponible : information indisponible
                </p>
                <p
                  className="mt-1 text-xs"
                  style={{ color: "var(--bc-color-text-muted)" }}
                >
                  La capacité du ballon actif n’est pas renseignée.
                </p>
              </div>
            </article>

            <article
              className="rounded-[28px] border p-5"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                boxShadow: "var(--bc-shadow-xs)",
              }}
            >
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                openAIP
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                Espaces aériens rencontrés
              </h2>
              <p className="mt-4 text-3xl font-semibold tracking-tight">
                {airspaceCoverage.visibleLoading
                  ? "Chargement…"
                  : `${airspaceCoverage.airspaces.features.length}`}
              </p>
              <p
                className="mt-1 text-sm"
                style={{ color: "var(--bc-color-text-secondary)" }}
              >
                {airspaceCoverage.statusMessage ??
                  "Espaces visibles dans la zone cartographique chargée."}
              </p>
            </article>

            <article
              className="rounded-[28px] border p-5"
              style={{
                background: "var(--bc-surface)",
                borderColor: "var(--bc-border)",
                boxShadow: "var(--bc-shadow-xs)",
              }}
            >
              <p
                className="text-[10px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                Information aéronautique
              </p>
              <h2 className="mt-1 text-lg font-semibold">
                NOTAM impactant la trajectoire
              </h2>
              <p
                className="mt-4 text-sm"
                style={{ color: "var(--bc-color-text-secondary)" }}
              >
                Information indisponible.
              </p>
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--bc-color-text-muted)" }}
              >
                Vérifier les publications officielles avant le vol.
              </p>
            </article>
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
    </main>
  );
}
