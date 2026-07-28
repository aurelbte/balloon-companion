"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Layers3,
  LocateFixed,
  X,
} from "lucide-react";
import PreparationMap from "../components/PreparationMap";
import AirspaceDetails from "../components/flight/AirspaceDetails";
import { useSelectedAirspace } from "../hooks/useSelectedAirspace";
import {
  useAirspaceCoverage,
  type AirspaceCoverageViewport,
} from "../hooks/useAirspaceCoverage";
import { getAirspaceFrequencyPresentations } from "../lib/operationalFrequency";
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
    DEFAULT_ANALYSIS_LAYERS,
  );
  const [traces, setTraces] = useState<WeatherAnalysisTrace[]>([]);
  const [failures, setFailures] = useState<WeatherAnalysisState["failures"]>([]);
  const [visibleTraceIds, setVisibleTraceIds] = useState<string[]>([]);
  const [exportIds, setExportIds] = useState<string[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recenterToken, setRecenterToken] = useState(0);
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
          setLayers(cached.layers);
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
  const updateLayer = (key: keyof AnalysisLayerSettings, value: boolean) => {
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

  return (
    <main className="relative h-dvh overflow-hidden bg-[#07111f]">
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
          onViewportChange={setViewport}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm font-bold text-white/70">
          {loading ? "Calcul des trajectoires…" : "Aucune trajectoire disponible"}
        </div>
      )}

      <button
        type="button"
        onClick={() => router.push("/prepare")}
        className="absolute left-3 top-[max(12px,env(safe-area-inset-top))] z-30 flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-[#07111feb] text-white"
        aria-label="Fermer l’analyse"
      >
        <X size={24} />
      </button>

      <button
        type="button"
        onClick={() => setLeftOpen((value) => !value)}
        className="absolute left-3 top-[max(72px,calc(env(safe-area-inset-top)+60px))] z-30 flex h-11 w-11 items-center justify-center rounded-xl border border-white/25 bg-[#07111feb] text-white"
        aria-label="Modèles météo"
      >
        {leftOpen ? <ChevronLeft /> : <ChevronRight />}
      </button>
      {leftOpen && (
        <aside className="absolute left-3 top-[max(122px,calc(env(safe-area-inset-top)+110px))] z-20 w-40 rounded-2xl border border-white/20 bg-[#07111ff0] p-2.5 text-white shadow-2xl">
          <h2 className="mb-2 text-xs font-black uppercase">Modèles météo</h2>
          <div className="grid gap-1.5">
            {WEATHER_MODEL_REGISTRY.filter((model) => model.supported).map(
              (model) => {
                const selected = selectedModels.includes(model.id);
                return (
                  <button
                    key={model.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleModel(model.id)}
                    className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border px-2 text-xs font-black ${
                      selected ? "border-white/70 bg-white/15" : "border-white/15"
                    }`}
                  >
                    {model.label}
                    <ModelLinePreview model={model} />
                  </button>
                );
              },
            )}
          </div>
        </aside>
      )}

      <button
        type="button"
        onClick={() => setRightOpen((value) => !value)}
        className="absolute right-3 top-[max(72px,calc(env(safe-area-inset-top)+60px))] z-30 flex h-11 w-11 items-center justify-center rounded-xl border border-white/25 bg-[#07111feb] text-white"
        aria-label="Altitudes"
      >
        {rightOpen ? <ChevronRight /> : <ChevronLeft />}
      </button>
      {rightOpen && (
        <aside className="absolute right-3 top-[max(122px,calc(env(safe-area-inset-top)+110px))] z-20 w-36 rounded-2xl border border-white/20 bg-[#07111ff0] p-2.5 text-white shadow-2xl">
          <h2 className="mb-2 text-xs font-black uppercase">Altitudes</h2>
          <div className="grid grid-cols-2 gap-1.5">
            {ALTITUDE_OPTIONS.map((altitude) => {
              const selected = selectedAltitudes.includes(altitude);
              const color =
                displayedTraces.find(
                  (trace) => trace.altitudeKey === altitudeKey(altitude),
                )?.color ?? "#ffffff";
              return (
                <button
                  key={String(altitude)}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleAltitude(altitude)}
                  className={`min-h-10 rounded-lg border text-[10px] font-black ${
                    selected ? "bg-white/15" : ""
                  }`}
                  style={{
                    borderColor: selected ? color : "rgb(255 255 255 / 15%)",
                    color: selected ? color : "white",
                  }}
                >
                  {altitudeLabel(altitude)}
                </button>
              );
            })}
          </div>
        </aside>
      )}

      <div className="absolute right-3 top-[max(12px,env(safe-area-inset-top))] z-30">
        <button
          type="button"
          onClick={() => setLayersOpen((value) => !value)}
          className="flex min-h-12 items-center gap-2 rounded-xl border border-white/25 bg-[#07111feb] px-3 text-xs font-black text-white"
        >
          <Layers3 size={18} /> Couches
        </button>
        {layersOpen && (
          <aside className="mt-1.5 w-56 rounded-xl border border-white/20 bg-[#07111ff5] p-2 text-white">
            {(
              [
                ["trajectories", "Trajectoires prévues"],
                ["airspaces", "Espaces aériens"],
                ["aeronauticalMap", "Carte aéronautique"],
                ["satellite", "Imagerie satellite"],
                ["highContrast", "Contraste élevé"],
                ["timeMarkers", "Marqueurs temporels"],
                ["arrivalMarkers", "Marqueurs d’arrivée"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex min-h-10 items-center justify-between gap-2 text-xs font-bold"
              >
                {label}
                <input
                  type="checkbox"
                  checked={layers[key]}
                  disabled={key === "satellite" && !satelliteAvailable}
                  onChange={(event) => updateLayer(key, event.target.checked)}
                  className="h-5 w-5 accent-[#f59e42]"
                />
              </label>
            ))}
          </aside>
        )}
      </div>

      <button
        type="button"
        onClick={() => setRecenterToken((value) => value + 1)}
        className="absolute bottom-[max(96px,calc(82px+env(safe-area-inset-bottom)))] right-3 z-20 flex h-11 w-11 items-center justify-center rounded-xl border border-white/25 bg-[#07111feb] text-white"
        aria-label="Recentrer toutes les trajectoires"
      >
        <LocateFixed size={20} />
      </button>

      <section className="absolute bottom-[max(8px,env(safe-area-inset-bottom))] left-3 z-20 w-[min(320px,calc(100vw-72px))] rounded-2xl border border-white/20 bg-[#07111ff2] text-white shadow-2xl">
        <button
          type="button"
          onClick={() => setLegendOpen((value) => !value)}
          className="flex min-h-11 w-full items-center justify-between px-3 text-xs font-black"
        >
          Légende · {displayedTraces.length} trajectoires
          <span>{legendOpen ? "−" : "+"}</span>
        </button>
        {legendOpen && (
          <div className="grid max-h-[34vh] gap-2 overflow-y-auto border-t border-white/15 p-2.5">
            <div>
              <p className="mb-1 text-[9px] font-black uppercase text-white/55">
                Altitudes
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {selectedAltitudes.map((altitude) => {
                  const trace = displayedTraces.find(
                    (item) => item.altitudeKey === altitudeKey(altitude),
                  );
                  return (
                    <span key={String(altitude)} className="text-[10px] font-bold">
                      <span style={{ color: trace?.color ?? "white" }}>●</span>{" "}
                      {altitudeLabel(altitude)}
                    </span>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[9px] font-black uppercase text-white/55">
                Modèles
              </p>
              {selectedModels.map((modelId) => {
                const model = WEATHER_MODEL_REGISTRY.find(
                  (item) => item.id === modelId,
                );
                return model ? (
                  <div key={model.id} className="flex items-center gap-2 text-[10px] font-bold">
                    <ModelLinePreview model={model} /> {model.label}
                  </div>
                ) : null;
              })}
            </div>
            <div className="border-t border-white/15 pt-1">
              <p className="mb-1 text-[9px] font-black uppercase text-white/55">
                Export vers Vol
              </p>
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
        <p className="absolute left-1/2 top-[max(14px,env(safe-area-inset-top))] z-40 -translate-x-1/2 rounded-full border border-white/20 bg-[#07111ff0] px-3 py-2 text-[10px] font-bold text-white">
          {loading ? "Mise à jour météo…" : notice}
        </p>
      )}

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
