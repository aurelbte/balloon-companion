"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useFlightRuntime } from "../contexts/FlightRuntimeContext";
import { useSelectedAirspace } from "../hooks/useSelectedAirspace";
import { useFlightContext } from "../hooks/useFlightContext";
import { useAirspaceCoverage, type AirspaceCoverageViewport } from "../hooks/useAirspaceCoverage";
import {
  buildGpsProjectionPoints,
  buildWeatherProjectionPoints,
} from "../lib/geo";
import {
  type AirspaceGeoJsonProperties,
} from "../lib/openaip";
import {
  getAirspaceBadgePresentation,
  type FlightContextGpsStatus,
} from "../lib/flightContext";
import {
  getAirspaceFrequencyPresentations,
  selectOperationalFrequency,
} from "../lib/operationalFrequency";
import FlightMap from "../components/flight/FlightMap";
import FlightInstruments from "../components/flight/FlightInstruments";
import FlightControls from "../components/flight/FlightControls";
import MapOptionsPopover from "../components/flight/MapOptionsPopover";
import AirspaceDetails from "../components/flight/AirspaceDetails";
import CurrentAirspaceBadge from "../components/flight/CurrentAirspaceBadge";
import FlightRecoveryDialog from "../components/flight/FlightRecoveryDialog";
import RecordedFlightScreen from "../components/flight/RecordedFlightScreen";
import ActiveFlightNavigationDialog from "../components/flight/ActiveFlightNavigationDialog";
import NavigationBar from "../components/NavigationBar";
import {
  getFlightNavigationIntent,
  resolveFlightNavigationAction,
} from "../lib/flightNavigation";
import {
  getFollowPositionAfterAction,
  getMapOptionsOpenAfterAction,
  isMapDisplayCustomized,
} from "../lib/flightMapPresentation";
import type {
  BaseMap,
  FlightLayerSettings,
  ProjectionPoint,
} from "../types/flight";

export default function FlightPage() {
  const router = useRouter();
  const [layerSettings, setLayerSettings] = useState<FlightLayerSettings>({
    gpsProjection: true,
    weatherProjection: false,
    airspaces: false,
    aeronauticalMap: false,
    highContrast: false,
  });

  const [isMapOptionsOpen, setIsMapOptionsOpen] = useState(false);
  const [followPosition, setFollowPosition] = useState(true);
  const [recenterRequest, setRecenterRequest] = useState(0);
  const [fitProjectionRequest, setFitProjectionRequest] = useState(0);
  const [baseMap, setBaseMap] = useState<BaseMap>("plan");
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  const [airspaceViewport, setAirspaceViewport] =
    useState<AirspaceCoverageViewport | null>(null);
  const [airspaceSelectionOrigin, setAirspaceSelectionOrigin] = useState<
    "manual" | "current"
  >("manual");
  const [stopConfirmationOpen, setStopConfirmationOpen] = useState(false);
  const [flightActionBusy, setFlightActionBusy] = useState(false);
  const [pendingNavigationTarget, setPendingNavigationTarget] = useState<
    string | null
  >(null);
  const satelliteConfigured = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY);

  const { geolocation, tracking } = useFlightRuntime();
  const {
    point: currentPosition,
    state: geoState,
    error: geoError,
    isStale,
    requestPermission,
    stopTracking: stopGeolocation,
  } = geolocation;
  const {
    selectedAirspaces,
    selectedAirspace,
    selectedIndex: selectedAirspaceIndex,
    verticalContext,
    selectAirspaces,
    selectPrevious,
    selectNext,
    closeSelection,
  } = useSelectedAirspace(
    !isStale &&
      currentPosition?.altitude !== null &&
      currentPosition?.altitude !== undefined &&
      Number.isFinite(currentPosition.altitude)
      ? currentPosition.altitude
      : null,
    !isStale ? (currentPosition?.verticalAccuracy ?? null) : null
  );
  const airspaceCoverage = useAirspaceCoverage({
    position: currentPosition,
    isPositionStale: isStale,
    viewport: airspaceViewport,
    explorationEnabled: layerSettings.airspaces,
  });
  const airspaces = airspaceCoverage.airspaces;

  // Suivi du vol
  const {
    isTracking,
    points,
    metrics,
    startTracking,
    stopTracking,
    storageReady,
    storageError,
    recoverableFlight,
    completedFlight,
    resumeInterruptedFlight,
    completeInterruptedFlight,
    abandonInterruptedFlight,
    dismissCompletedFlight,
    markAcquiring,
    markReady,
  } = tracking;

  // Une projection exige un point frais, un cap réel et une vitesse suffisante.
  // Un cap absent ne doit jamais être interprété comme un cap nord (0°).
  const gpsProjection = useMemo<ProjectionPoint[]>(() => {
    if (
      !currentPosition ||
      isStale ||
      currentPosition.heading === null ||
      !Number.isFinite(currentPosition.heading) ||
      currentPosition.speed === null ||
      !Number.isFinite(currentPosition.speed) ||
      currentPosition.speed <= 0.5 / 3.6
    ) {
      return [];
    }

    return buildGpsProjectionPoints(
      currentPosition.latitude,
      currentPosition.longitude,
      currentPosition.heading,
      currentPosition.speed * 3.6
    );
  }, [currentPosition, isStale]);

  const weatherProjection = useMemo<ProjectionPoint[]>(() => {
    if (
      !layerSettings.weatherProjection ||
      gpsProjection.length === 0 ||
      !currentPosition
    ) {
      return [];
    }

    return buildWeatherProjectionPoints(
      currentPosition.latitude,
      currentPosition.longitude,
      currentPosition.heading as number,
      (currentPosition.speed as number) * 3.6
    );
  }, [currentPosition, gpsProjection.length, layerSettings.weatherProjection]);

  useEffect(() => {
    markAcquiring();
    requestPermission();
  }, [markAcquiring, requestPermission]);

  useEffect(() => {
    if ((geoState === "active" || geoState === "simulation") && !isStale) {
      markReady();
    }
  }, [geoState, isStale, markReady]);

  // Handlers pour les boutons
  const handleRecenterMap = useCallback(() => {
    if (!currentPosition) return;
    setFollowPosition((current) =>
      getFollowPositionAfterAction(current, "RECENTER"),
    );
    setRecenterRequest((request) => request + 1);
  }, [currentPosition]);

  const handleFitProjection = useCallback(() => {
    if (!currentPosition) return;
    setFollowPosition((current) =>
      getFollowPositionAfterAction(current, "FIT_PROJECTION"),
    );
    setFitProjectionRequest((request) => request + 1);
  }, [currentPosition]);

  const handleStartTracking = useCallback(() => {
    if (!storageReady) return;
    if ((geoState === "active" || geoState === "simulation") && !isStale) {
      startTracking(currentPosition);
    } else {
      markAcquiring();
      requestPermission();
    }
  }, [
    currentPosition,
    geoState,
    isStale,
    markAcquiring,
    requestPermission,
    startTracking,
    storageReady,
  ]);

  const handleConfirmStopTracking = useCallback(async () => {
    setFlightActionBusy(true);
    const completed = await stopTracking();
    setFlightActionBusy(false);
    if (completed) {
      setStopConfirmationOpen(false);
      stopGeolocation();
    }
  }, [stopGeolocation, stopTracking]);

  const handleNavigationRequest = useCallback(
    (target: string) => {
      if (target === "/flight" || flightActionBusy) return;
      const intent = getFlightNavigationIntent({
        target,
        isFlightRecording: isTracking,
      });
      if (intent.kind === "NAVIGATE") {
        router.push(intent.target);
        return;
      }
      setPendingNavigationTarget(intent.target);
    },
    [flightActionBusy, isTracking, router],
  );

  const handleStayOnFlight = useCallback(() => {
    const resolution = resolveFlightNavigationAction({
      action: "STAY",
      pendingTarget: pendingNavigationTarget,
    });
    setPendingNavigationTarget(resolution.pendingTarget);
  }, [pendingNavigationTarget]);

  const handleContinueNavigation = useCallback(() => {
    if (flightActionBusy) return;
    const resolution = resolveFlightNavigationAction({
      action: "CONTINUE",
      pendingTarget: pendingNavigationTarget,
    });
    setPendingNavigationTarget(resolution.pendingTarget);
    if (resolution.navigateTo) router.push(resolution.navigateTo);
  }, [flightActionBusy, pendingNavigationTarget, router]);

  const handleFinalizeBeforeNavigation = useCallback(async () => {
    if (flightActionBusy) return;
    const resolution = resolveFlightNavigationAction({
      action: "FINALIZE",
      pendingTarget: pendingNavigationTarget,
    });
    if (!resolution.navigateTo) {
      setPendingNavigationTarget(null);
      return;
    }
    setFlightActionBusy(true);
    const completed = await stopTracking();
    if (completed) {
      dismissCompletedFlight();
      stopGeolocation();
      setPendingNavigationTarget(null);
      router.push(resolution.navigateTo);
    }
    setFlightActionBusy(false);
  }, [
    dismissCompletedFlight,
    flightActionBusy,
    pendingNavigationTarget,
    router,
    stopGeolocation,
    stopTracking,
  ]);

  const handleCompleteInterruptedFlight = useCallback(async () => {
    setFlightActionBusy(true);
    await completeInterruptedFlight();
    setFlightActionBusy(false);
  }, [completeInterruptedFlight]);

  const handleAbandonInterruptedFlight = useCallback(async () => {
    if (
      !window.confirm(
        "Abandonner définitivement cet enregistrement et tous ses points ?"
      )
    ) {
      return;
    }
    setFlightActionBusy(true);
    await abandonInterruptedFlight();
    setFlightActionBusy(false);
  }, [abandonInterruptedFlight]);

  const handleBaseMapChange = useCallback(
    (nextBaseMap: BaseMap) => {
      if (nextBaseMap === "satellite" && !satelliteConfigured) return;
      setBaseMap(nextBaseMap);
    },
    [satelliteConfigured]
  );

  const handleLayerSettingsChange = useCallback(
    (nextSettings: FlightLayerSettings) => {
      if (layerSettings.airspaces && !nextSettings.airspaces) {
        closeSelection();
      }
      setLayerSettings(nextSettings);
    },
    [closeSelection, layerSettings.airspaces]
  );

  const handleViewportChange = useCallback(
    (viewport: AirspaceCoverageViewport) => {
      setAirspaceViewport(viewport);
    },
    []
  );

  const handleSatelliteError = useCallback((message: string) => {
    setBaseMap("plan");
    setSatelliteError(message);
  }, []);

  const handleCloseMapOptions = useCallback(() => {
    setIsMapOptionsOpen((isOpen) =>
      getMapOptionsOpenAfterAction(isOpen, "MAP_PRESS"),
    );
  }, []);

  const displayedMetrics = useMemo(
    () =>
      isStale
        ? {
            ...metrics,
            altitude: null,
            verticalSpeed: null,
            groundSpeed: null,
            heading: null,
          }
        : metrics,
    [isStale, metrics]
  );

  const flightContextGpsStatus: FlightContextGpsStatus =
    isStale && currentPosition
      ? "STALE"
      : geoState === "requesting"
        ? "ACQUIRING"
        : (geoState === "active" || geoState === "simulation") &&
            currentPosition
          ? "ACTIVE"
          : "UNAVAILABLE";

  const flightContext = useFlightContext({
    position: currentPosition,
    gpsStatus: flightContextGpsStatus,
    airspaces,
    loadedCoverage: airspaceCoverage.loadedCoverage,
    airspaceDataAvailable:
      airspaceCoverage.gpsCoverage.status === "COMPLETE" ||
      airspaceCoverage.gpsCoverage.status === "PARTIAL",
  });
  const operationalFrequency = useMemo(
    () => selectOperationalFrequency(flightContext),
    [flightContext]
  );
  const airspaceBadgePresentation = useMemo(
    () =>
      getAirspaceBadgePresentation(flightContext, operationalFrequency),
    [flightContext, operationalFrequency]
  );
  const selectedAirspaceFrequencies = useMemo(
    () =>
      selectedAirspace
        ? getAirspaceFrequencyPresentations(
            selectedAirspace,
            operationalFrequency
          )
        : [],
    [operationalFrequency, selectedAirspace]
  );
  const currentAirspaceContext = flightContext.airspace.current;
  const containingAirspaceContexts = flightContext.airspace.containing;

  const handleManualAirspaceSelection = useCallback(
    (nextAirspaces: AirspaceGeoJsonProperties[]) => {
      setAirspaceSelectionOrigin("manual");
      selectAirspaces(nextAirspaces);
    },
    [selectAirspaces]
  );

  const handleOpenCurrentAirspace = useCallback(() => {
    if (!currentAirspaceContext) return;
    setAirspaceSelectionOrigin("current");
    selectAirspaces(
      containingAirspaceContexts.map((context) => context.airspace)
    );
  }, [
    containingAirspaceContexts,
    currentAirspaceContext,
    selectAirspaces,
  ]);

  const mapDisplayCustomized = isMapDisplayCustomized({
    baseMap,
    airspaces: layerSettings.airspaces,
    highContrast: layerSettings.highContrast,
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100dvh",
        overflow: "hidden",
      }}
    >
    {/* Carte plein écran */}
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
      }}
    >
        <FlightMap
          currentPosition={isStale ? null : currentPosition}
          baseMap={baseMap}
          flightPoints={points}
          gpsProjection={gpsProjection}
          weatherProjection={weatherProjection}
          airspaces={airspaces}
          showAirspaces={layerSettings.airspaces}
          selectedAirspaceId={selectedAirspace?.airspaceId ?? null}
          showGpsProjection={layerSettings.gpsProjection && isTracking}
          showWeatherProjection={layerSettings.weatherProjection && isTracking}
          followPosition={followPosition}
          recenterRequest={recenterRequest}
          fitProjectionRequest={fitProjectionRequest}
          onSatelliteError={handleSatelliteError}
          onAirspacesSelected={handleManualAirspaceSelection}
          onFollowPositionChange={setFollowPosition}
          onMapPress={handleCloseMapOptions}
          onViewportChange={handleViewportChange}
        />
      </div>

      {/* Panneau d'instruments */}
      <FlightInstruments
        metrics={displayedMetrics}
        isRecording={isTracking}
        highContrast={layerSettings.highContrast}
        geolocationState={geoState}
        withNavigation
      />

      <CurrentAirspaceBadge
        presentation={airspaceBadgePresentation}
        onOpenCurrentAirspace={handleOpenCurrentAirspace}
      />

      {geoState === "simulation" && (
        <span
          aria-label="Mode test, position GPS simulée"
          style={{
            position: "fixed",
            top: "max(58px, calc(env(safe-area-inset-top) + 42px))",
            right: "16px",
            zIndex: 19,
            color: "rgba(253, 230, 138, 0.82)",
            fontSize: "8px",
            fontWeight: 800,
            letterSpacing: "0.08em",
          }}
        >
          TEST
        </span>
      )}

      {layerSettings.airspaces && airspaceCoverage.visibleLoading && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: "max(58px, calc(env(safe-area-inset-top) + 42px))",
            left: "50%",
            zIndex: 19,
            transform: "translateX(-50%)",
            padding: "6px 9px",
            borderRadius: "9px",
            background: "rgba(7, 17, 31, 0.88)",
            color: "var(--bc-text-primary)",
            fontSize: "10px",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          Chargement des espaces…
        </div>
      )}

      {/* Boutons flottants */}
      <FlightControls
        isTracking={isTracking}
        followPosition={followPosition}
        mapOptionsOpen={isMapOptionsOpen}
        mapDisplayCustomized={mapDisplayCustomized}
        withNavigation
        onRecenterMap={handleRecenterMap}
        onFitProjection={handleFitProjection}
        onToggleMapOptions={() =>
          setIsMapOptionsOpen((isOpen) =>
            getMapOptionsOpenAfterAction(isOpen, "TOGGLE"),
          )
        }
        onStartTracking={handleStartTracking}
        onStopTracking={() => setStopConfirmationOpen(true)}
      />

      {!isTracking && !recoverableFlight && !completedFlight && (
        <p
          style={{
            position: "fixed",
            right: "16px",
            bottom: "calc(max(6px, env(safe-area-inset-bottom)) + 292px)",
            zIndex: 18,
            width: "min(220px, 58vw)",
            margin: 0,
            color: "rgba(244,247,251,.78)",
            fontSize: "10px",
            lineHeight: 1.35,
            textAlign: "right",
            textShadow: "0 1px 3px #000",
          }}
        >
          Pour un enregistrement continu sur iPhone, garder Balloon Companion
          ouverte et l’écran allumé.
        </p>
      )}

      {storageError && (
        <div
          role="alert"
          style={{
            position: "fixed",
            left: "16px",
            right: "16px",
            bottom: "calc(max(6px, env(safe-area-inset-bottom)) + 126px)",
            zIndex: 70,
            padding: "10px 12px",
            borderRadius: "12px",
            background: "rgba(127,29,29,.95)",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 800,
          }}
        >
          {storageError}
        </div>
      )}

      {stopConfirmationOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmer l’arrêt du vol"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "grid",
            placeItems: "center",
            padding: "20px",
            background: "rgba(2,8,18,.78)",
          }}
        >
          <section
            style={{
              width: "min(100%, 380px)",
              padding: "22px",
              borderRadius: "20px",
              background: "var(--bc-background-elevated)",
              border: "1px solid var(--bc-border-strong)",
            }}
          >
            <h2 style={{ fontSize: "23px", fontWeight: 950 }}>
              Arrêter et enregistrer ce vol ?
            </h2>
            <div style={{ display: "grid", gap: "10px", marginTop: "20px" }}>
              <button
                disabled={flightActionBusy}
                onClick={() => setStopConfirmationOpen(false)}
                style={{
                  minHeight: "52px",
                  borderRadius: "13px",
                  border: "1px solid var(--bc-border)",
                  background: "var(--bc-surface)",
                  color: "var(--bc-text-primary)",
                  fontWeight: 900,
                }}
              >
                CONTINUER LE VOL
              </button>
              <button
                disabled={flightActionBusy}
                onClick={() => void handleConfirmStopTracking()}
                style={{
                  minHeight: "52px",
                  borderRadius: "13px",
                  border: 0,
                  background: "var(--bc-danger)",
                  color: "#fff",
                  fontWeight: 900,
                }}
              >
                ARRÊTER ET ENREGISTRER
              </button>
            </div>
          </section>
        </div>
      )}

      {recoverableFlight && (
        <FlightRecoveryDialog
          flight={recoverableFlight}
          busy={flightActionBusy}
          onResume={resumeInterruptedFlight}
          onComplete={() => void handleCompleteInterruptedFlight()}
          onAbandon={() => void handleAbandonInterruptedFlight()}
        />
      )}

      {completedFlight && (
        <RecordedFlightScreen
          flight={completedFlight}
          onReturn={dismissCompletedFlight}
        />
      )}

      {pendingNavigationTarget && isTracking && (
        <ActiveFlightNavigationDialog
          busy={flightActionBusy}
          onStay={handleStayOnFlight}
          onContinue={handleContinueNavigation}
          onFinalize={() => void handleFinalizeBeforeNavigation()}
        />
      )}

      <MapOptionsPopover
        isOpen={isMapOptionsOpen}
        settings={layerSettings}
        baseMap={baseMap}
        satelliteAvailable={satelliteConfigured && satelliteError === null}
        satelliteMessage={
          satelliteError ??
          (!satelliteConfigured
            ? "Fond satellite non configuré"
            : null)
        }
        airspacesLoading={airspaceCoverage.visibleLoading}
        airspacesError={airspaceCoverage.statusMessage}
        airspacesStatus={airspaceCoverage.uiState}
        onBaseMapChange={handleBaseMapChange}
        onSettingsChange={handleLayerSettingsChange}
        onClose={handleCloseMapOptions}
      />

      {selectedAirspace && verticalContext && (
        <AirspaceDetails
          airspace={selectedAirspace}
          verticalContext={verticalContext}
          currentIndex={selectedAirspaceIndex}
          totalCount={selectedAirspaces.length}
          onPrevious={selectPrevious}
          onNext={selectNext}
          onClose={closeSelection}
          contextLabel={
            airspaceSelectionOrigin === "current"
              ? "ESPACE ACTUEL"
              : "ESPACE CONSULTÉ"
          }
          frequencies={selectedAirspaceFrequencies}
        />
      )}

      {/* Indicateur d'erreur GPS */}
      {geoError && geoState !== "simulation" && (
        <div
          style={{
            position: "fixed",
            top: "max(112px, calc(env(safe-area-inset-top) + 96px))",
            right: "16px",
            backgroundColor: "rgba(239, 68, 68, 0.1)",
            border: "1px solid var(--bc-danger)",
            borderRadius: "8px",
            padding: "12px 16px",
            fontSize: "13px",
            color: "var(--bc-danger)",
            zIndex: 20,
            maxWidth: "300px",
          }}
        >
          ⚠ {geoError}
        </div>
      )}
      <NavigationBar activeItem="Vol" onNavigate={handleNavigationRequest} />
    </div>
  );
}
