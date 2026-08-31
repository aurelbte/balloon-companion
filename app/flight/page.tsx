"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
import WindProfilePanel from "../components/flight/WindProfilePanel";
import FlightInstruments from "../components/flight/FlightInstruments";
import FlightControls from "../components/flight/FlightControls";
import MapOptionsPopover from "../components/flight/MapOptionsPopover";
import AirspaceDetails from "../components/flight/AirspaceDetails";
import CurrentAirspaceBadge from "../components/flight/CurrentAirspaceBadge";
import FlightRecoveryDialog from "../components/flight/FlightRecoveryDialog";
import RecordedFlightScreen from "../components/flight/RecordedFlightScreen";
import ActiveFlightNavigationDialog from "../components/flight/ActiveFlightNavigationDialog";
import NavigationBar from "../components/NavigationBar";
import PlannedTrajectoriesInfo from "../components/flight/PlannedTrajectoriesInfo";
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
import {
  loadExportedPlannedTrajectories,
  loadFlightWeatherSnapshot,
  type ExportedPlannedTrajectory,
  type FlightWeatherSnapshot,
} from "../lib/trajectory/weatherAnalysisStorage";
import { Button, FloatingPanel } from "../design-system";
import { createFlightSession } from "../lib/flightCore";
import { aggregateObservedWind, snapshotWindProfile } from "../lib/flightWindProfile";
import { loadPreparationDraft } from "../lib/preparationDraftStorage";
import { loadAviationPreferences } from "../lib/aviation/aviationPreferencesStorage";
import { loadAviationWeatherForAirport } from "../lib/aviation/aviationWeatherService";
import { qnhHpaFromMetar } from "../weather/aviationPresentation";
import { useBalloonAuth } from "../contexts/AuthContext";
import LiveFlightSimulatorPanel from "../components/flight/LiveFlightSimulatorPanel";
import type { SharedPilotMapEntry } from "../lib/liveFlightMap.ts";
import LiveSharingPanel from "../components/flight/LiveSharingPanel";
import { loadFriendsSnapshot, type FriendProfile } from "../lib/friends.ts";
import { createBrowserSupabaseClient } from "../lib/supabase/client.ts";
import { EMPTY_LIVE_SHARING_UI_STATE, stopLiveSharingUi, type LiveSharingUiState } from "../lib/liveFlightUi.ts";
import { LiveFlightRuntime, type LivePositionSource } from "../lib/liveFlightRuntime.ts";
import { canUseLiveFlightPublisherControls, shouldPublishTrackedLiveSource, shouldRequestLocalFlightGeolocationOnMount, shouldStartGpslessTargetedLiveFlight } from "../lib/liveFlightSimulator.ts";

export default function FlightPage() {
  const router = useRouter();
  const auth = useBalloonAuth();
  const currentUserId = auth.state === "SIGNED_IN" ? (auth.user?.id ?? null) : null;
  const shouldRequestLocalGeolocation = typeof window === "undefined"
    ? true
    : shouldRequestLocalFlightGeolocationOnMount(window.location.search);
  const completionPath = () => `/flight/complete${new URLSearchParams(window.location.search).get("cloudSyncTest") === "targeted" ? "?cloudSyncTest=targeted" : ""}`;
  const satelliteConfigured = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY);
  const [layerSettings, setLayerSettings] = useState<FlightLayerSettings>({
    gpsProjection: true,
    weatherProjection: false,
    airspaces: false,
    powerLines: false,
    aeronauticalMap: false,
    highContrast: false,
  });

  const [isMapOptionsOpen, setIsMapOptionsOpen] = useState(false);
  const [isWindProfileOpen, setIsWindProfileOpen] = useState(false);
  const [isLiveSharingOpen, setIsLiveSharingOpen] = useState(false);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [friendsUserId, setFriendsUserId] = useState<string | null>(null);
  const [liveSharingUi, setLiveSharingUi] = useState<LiveSharingUiState>(EMPTY_LIVE_SHARING_UI_STATE);
  const [liveSharingUserId, setLiveSharingUserId] = useState<string | null>(null);
  const [followPosition, setFollowPosition] = useState(true);
  const [recenterRequest, setRecenterRequest] = useState(0);
  const [fitProjectionRequest, setFitProjectionRequest] = useState(0);
  const [baseMap, setBaseMap] = useState<BaseMap>(
    satelliteConfigured ? "satellite" : "plan"
  );
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  const [plannedTrajectories, setPlannedTrajectories] = useState<
    ExportedPlannedTrajectory[]
  >([]);
  const [validatedWeatherSnapshot, setValidatedWeatherSnapshot] =
    useState<FlightWeatherSnapshot | null>(null);
  const [airspaceViewport, setAirspaceViewport] =
    useState<AirspaceCoverageViewport | null>(null);
  const [airspaceSelectionOrigin, setAirspaceSelectionOrigin] = useState<
    "manual" | "current"
  >("manual");
  const [stopConfirmationOpen, setStopConfirmationOpen] = useState(false);
  const [flightActionBusy, setFlightActionBusy] = useState(false);
  const [demoFlightEnding, setDemoFlightEnding] = useState(false);
  const [qnhHpa, setQnhHpa] = useState<number | null>(null);
  const [pendingNavigationTarget, setPendingNavigationTarget] = useState<
    string | null
  >(null);
  const [realSharedPilots, setRealSharedPilots] = useState<SharedPilotMapEntry[]>([]);
  const [simulatedSharedPilots, setSimulatedSharedPilots] = useState<SharedPilotMapEntry[]>([]);
  const [incomingOwnerIds, setIncomingOwnerIds] = useState<string[]>([]);
  const [targetedLiveTestFlightActive, setTargetedLiveTestFlightActive] = useState(false);
  const [livePublisherScenarioActive, setLivePublisherScenarioActive] = useState(false);
  const liveRuntimeRef = useRef<LiveFlightRuntime | null>(null);
  useEffect(() => {
    const userId = currentUserId;
    let active = true;
    if (!userId) {
      const timer = window.setTimeout(() => { setFriends([]); setFriendsUserId(null); setLiveSharingUi(stopLiveSharingUi()); setLiveSharingUserId(null); setIsLiveSharingOpen(false); }, 0);
      return () => { active = false; window.clearTimeout(timer); };
    }
    void loadFriendsSnapshot(createBrowserSupabaseClient(), userId)
      .then((snapshot) => { if (active && auth.user?.id === userId) { setFriends(snapshot.friends.map(({ friend }) => friend)); setFriendsUserId(userId); } })
      .catch(() => { if (active) setFriends([]); });
    return () => { active = false; };
  }, [auth.state, auth.user?.id, currentUserId]);

  useEffect(() => {
    const offline = () => setLiveSharingUi((state) => ({ ...state, connection: "OFFLINE" }));
    const online = () => setLiveSharingUi((state) => ({ ...state, connection: state.recipientIds.length ? "RECONNECTING" : "IDLE" }));
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, []);

  useEffect(() => {
    const userId = currentUserId;
    if (!userId) {
      const previous = liveRuntimeRef.current;
      liveRuntimeRef.current = null;
      if (previous) void previous.close();
      return;
    }
    const runtime = new LiveFlightRuntime(createBrowserSupabaseClient(), {
      onOutgoing: (snapshot) => {
        if (liveRuntimeRef.current !== runtime) return;
        setLiveSharingUserId(userId);
        setLiveSharingUi((state) => ({
          ...state,
          recipientIds: snapshot.recipientIds,
          pendingRecipientIds: snapshot.pendingRecipientIds,
          connection: snapshot.channelState === "SUBSCRIBED" ? "ACTIVE" : snapshot.channelState === "OFFLINE" ? "OFFLINE" : snapshot.recipientIds.length ? "RECONNECTING" : "IDLE",
        }));
      },
      onIncomingPilots: (pilots) => { if (liveRuntimeRef.current === runtime) setRealSharedPilots(pilots); },
      onIncomingOwners: (ownerIds) => { if (liveRuntimeRef.current === runtime) setIncomingOwnerIds([...ownerIds]); },
    });
    liveRuntimeRef.current = runtime;
    void runtime.start(userId);
    return () => { if (liveRuntimeRef.current === runtime) liveRuntimeRef.current = null; void runtime.close(); };
  }, [currentUserId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPlannedTrajectories(loadExportedPlannedTrajectories());
      setValidatedWeatherSnapshot(loadFlightWeatherSnapshot());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!demoFlightEnding) return;
    const timer = window.setTimeout(() => router.push(completionPath()), 850);
    return () => window.clearTimeout(timer);
  }, [demoFlightEnding, router]);

  useEffect(() => {
    const controller = new AbortController();
    const airport = loadAviationPreferences()?.airportIcao ?? null;
    if (!airport) return () => controller.abort();
    loadAviationWeatherForAirport(airport, controller.signal)
      .then((result) => setQnhHpa(qnhHpaFromMetar(result.data?.metarRaw ?? null)))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setQnhHpa(null);
      });
    return () => controller.abort();
  }, []);

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
    activeFlight,
    recoverableFlight,
    completedFlight,
    resumeInterruptedFlight,
    completeInterruptedFlight,
    ignoreInterruptedFlight,
    dismissCompletedFlight,
    markAcquiring,
    markReady,
  } = tracking;
  const livePublisherControlsEnabled = typeof window !== "undefined"
    && canUseLiveFlightPublisherControls(window.location.search, isTracking, targetedLiveTestFlightActive);
  const flightControlActive = isTracking || targetedLiveTestFlightActive;

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
    if (!shouldRequestLocalGeolocation) return;
    markAcquiring();
    requestPermission();
  }, [markAcquiring, requestPermission, shouldRequestLocalGeolocation]);

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
    const hasFreshLocalPosition = (geoState === "active" || geoState === "simulation") && !isStale && currentPosition !== null;
    if (shouldStartGpslessTargetedLiveFlight(window.location.search, hasFreshLocalPosition)) {
      setTargetedLiveTestFlightActive(true);
      return;
    }
    if (hasFreshLocalPosition) {
      const preparation = loadPreparationDraft();
      const selectedBalloonId = preparation?.balloonName;
      const weatherSnapshot = validatedWeatherSnapshot;
      startTracking(currentPosition, {
        ...(selectedBalloonId ? { balloonRegistration: selectedBalloonId } : {}),
        ...(weatherSnapshot
          ? {
              weatherModel: weatherSnapshot.weatherModel,
              weatherSnapshot,
            }
          : {}),
      });
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
    validatedWeatherSnapshot,
  ]);

  const handleDemoFlightEnd = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(completionPath());
      return;
    }
    setDemoFlightEnding(true);
  }, [router]);

  const handleStopFlightControl = useCallback(() => {
    if (!targetedLiveTestFlightActive) {
      setStopConfirmationOpen(true);
      return;
    }
    liveRuntimeRef.current?.stopOutgoingBestEffort();
    setLiveSharingUi(stopLiveSharingUi());
    setIsLiveSharingOpen(false);
    setTargetedLiveTestFlightActive(false);
  }, [targetedLiveTestFlightActive]);

  const handleConfirmStopTracking = useCallback(async () => {
    setFlightActionBusy(true);
    liveRuntimeRef.current?.stopOutgoingBestEffort();
    setLiveSharingUi(stopLiveSharingUi());
    setIsLiveSharingOpen(false);
    const completed = await stopTracking();
    setFlightActionBusy(false);
    if (completed) {
      setStopConfirmationOpen(false);
      stopGeolocation();
      router.push(completionPath());
    }
  }, [router, stopGeolocation, stopTracking]);

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
    liveRuntimeRef.current?.stopOutgoingBestEffort();
    setLiveSharingUi(stopLiveSharingUi());
    setIsLiveSharingOpen(false);
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
    setIsLiveSharingOpen(false);
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
  const liveSharingForCurrentUser = liveSharingUserId === currentUserId ? liveSharingUi : EMPTY_LIVE_SHARING_UI_STATE;
  const sharedPilots = useMemo(() => {
    const byId = new Map(realSharedPilots.map((pilot) => [pilot.pilotId, pilot]));
    for (const pilot of simulatedSharedPilots) byId.set(pilot.pilotId, pilot);
    return [...byId.values()];
  }, [realSharedPilots, simulatedSharedPilots]);
  const liveFriends = useMemo(() => {
    const byId = new Map((friendsUserId === currentUserId ? friends : []).map((friend) => [friend.userId, friend]));
    for (const pilot of sharedPilots) if (!byId.has(pilot.pilotId)) byId.set(pilot.pilotId, { userId: pilot.pilotId, displayName: pilot.displayName, handle: pilot.displayName.toLocaleLowerCase("fr-FR").replaceAll(" ", "."), searchEnabled: false });
    return [...byId.values()];
  }, [currentUserId, friends, friendsUserId, sharedPilots]);
  const displayedLiveSharingUi = useMemo<LiveSharingUiState>(() => ({ ...liveSharingForCurrentUser, incomingPilotIds: [...new Set([...incomingOwnerIds, ...simulatedSharedPilots.map((pilot) => pilot.pilotId)])] }), [incomingOwnerIds, liveSharingForCurrentUser, simulatedSharedPilots]);
  const flightSession = useMemo(
    () =>
      createFlightSession({
        status: tracking.status,
        storageReady,
        storageError,
        activeFlight,
        recoverableFlight,
        completedFlight,
        points,
        metrics: displayedMetrics,
        currentPosition,
        geolocationState: geoState,
        isPositionStale: isStale,
        gpsProjection,
        weatherProjection,
        plannedTrajectories,
        flightContext,
        qnhHpa,
      }),
    [
      activeFlight,
      completedFlight,
      currentPosition,
      displayedMetrics,
      flightContext,
      qnhHpa,
      geoState,
      gpsProjection,
      isStale,
      plannedTrajectories,
      points,
      recoverableFlight,
      storageError,
      storageReady,
      tracking.status,
      weatherProjection,
    ],
  );
  useEffect(() => {
    if (!shouldPublishTrackedLiveSource(livePublisherScenarioActive) || !flightSession.state.isRecording || !flightSession.position.current) return;
    const position = flightSession.position.current;
    const source: LivePositionSource = {
      latitude: position.latitude,
      longitude: position.longitude,
      altitude: position.altitude,
      groundSpeed: position.speed,
      heading: position.heading,
      durationSeconds: flightSession.statistics.metrics.durationSeconds,
      distanceKm: flightSession.statistics.metrics.distanceKm ?? 0,
      accuracy: position.accuracy,
      gpsTimestamp: position.gpsTimestamp ?? position.timestamp,
      fresh: !flightSession.position.isStale,
    };
    void liveRuntimeRef.current?.publishSource(source);
  }, [flightSession, livePublisherScenarioActive]);
  const observedWindProfile = useMemo(
    () => aggregateObservedWind(flightSession.trajectory.points),
    [flightSession.trajectory.points],
  );
  const flightWeatherSnapshot =
    activeFlight?.weatherSnapshot ??
    recoverableFlight?.weatherSnapshot ??
    validatedWeatherSnapshot;
  const predictedWinds = useMemo(
    () => snapshotWindProfile(flightWeatherSnapshot),
    [flightWeatherSnapshot],
  );
  const predictedModelLabel = flightWeatherSnapshot?.modelLabel ?? null;

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
          currentPosition={
            flightSession.position.isStale
              ? null
              : flightSession.position.current
          }
          baseMap={baseMap}
          flightPoints={flightSession.trajectory.points}
          gpsProjection={flightSession.projections.gps}
          weatherProjection={flightSession.projections.weather}
          plannedTrajectories={flightSession.projections.planned}
          sharedPilots={sharedPilots}
          airspaces={airspaces}
          showAirspaces={layerSettings.airspaces}
          showPowerLines={layerSettings.powerLines}
          selectedAirspaceId={selectedAirspace?.airspaceId ?? null}
          showGpsProjection={
            layerSettings.gpsProjection && flightSession.state.isRecording
          }
          showWeatherProjection={
            layerSettings.weatherProjection && flightSession.state.isRecording
          }
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

      <LiveFlightSimulatorPanel
        scopeKey={auth.state === "SIGNED_IN" ? (auth.user?.id ?? null) : null}
        trackingActive={livePublisherControlsEnabled}
        onPilotsChange={setSimulatedSharedPilots}
        onConnectionStateChange={(connection) => { setLiveSharingUserId(currentUserId); setLiveSharingUi((state) => ({ ...state, connection })); }}
        onPublisherSource={(source) => { void liveRuntimeRef.current?.publishSource(source, true); }}
        onPublisherEnd={() => {
          liveRuntimeRef.current?.stopOutgoingBestEffort();
          setLiveSharingUi(stopLiveSharingUi());
          setIsLiveSharingOpen(false);
          setTargetedLiveTestFlightActive(false);
        }}
        onPublisherScenarioActiveChange={setLivePublisherScenarioActive}
      />

      <LiveSharingPanel
        open={isLiveSharingOpen}
        friends={liveFriends}
        state={displayedLiveSharingUi}
        trackingActive={livePublisherControlsEnabled}
        onClose={() => setIsLiveSharingOpen(false)}
        onToggleRecipient={(friendId) => {
          const runtime = liveRuntimeRef.current;
          if (!runtime) return;
          if (liveSharingForCurrentUser.recipientIds.includes(friendId)) void runtime.removeRecipient(friendId).catch(() => undefined);
          else void runtime.addRecipient(friendId, activeFlight?.id ?? null).catch(() => undefined);
        }}
      />

      {/* Panneau d'instruments */}
      <WindProfilePanel
        open={isWindProfileOpen}
        observed={observedWindProfile}
        predicted={predictedWinds}
        predictedModelLabel={predictedModelLabel}
        onToggle={() => { setIsLiveSharingOpen(false); setIsMapOptionsOpen(false); setIsWindProfileOpen((open) => !open); }}
        onClose={() => setIsWindProfileOpen(false)}
      />
      <FlightInstruments
        session={flightSession}
        highContrast={layerSettings.highContrast}
        geolocationState={geoState}
        withNavigation
      />

      <CurrentAirspaceBadge
        presentation={airspaceBadgePresentation}
        onOpenCurrentAirspace={handleOpenCurrentAirspace}
      />

      <PlannedTrajectoriesInfo
        trajectories={flightSession.projections.planned}
      />

      {geoState === "simulation" && (
        <div
          style={{
            position: "fixed",
            top: "max(58px, calc(env(safe-area-inset-top) + 42px))",
            right: "16px",
            zIndex: 19,
            display: "grid",
            justifyItems: "end",
            gap: "7px",
          }}
        >
          <span aria-label="Mode test, position GPS simulée" style={{ color: "rgba(253, 230, 138, 0.82)", fontSize: "8px", fontWeight: 800, letterSpacing: "0.08em" }}>TEST</span>
          <button
            type="button"
            onClick={handleDemoFlightEnd}
            style={{ minHeight: "44px", padding: "0 12px", border: "1px solid rgba(253,230,138,.35)", borderRadius: "999px", background: "rgba(7,17,31,.9)", color: "#fde68a", fontSize: "10px", fontWeight: 750 }}
          >
            Simuler la fin du vol
          </button>
        </div>
      )}

      {demoFlightEnding && (
        <div role="status" aria-live="polite" style={{ position: "fixed", inset: 0, zIndex: 120, display: "grid", placeItems: "center", background: "var(--bc-background)" }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ color: "var(--bc-accent)", fontSize: "11px", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase" }}>Vol terminé</p>
            <strong style={{ display: "block", marginTop: "8px", fontSize: "34px", fontWeight: 600 }}>57 min</strong>
            <p style={{ marginTop: "7px", color: "var(--bc-text-secondary)", fontSize: "14px" }}>17,8 km · 982 m max</p>
          </div>
        </div>
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
        isTracking={flightControlActive}
        followPosition={followPosition}
        mapOptionsOpen={isMapOptionsOpen}
        mapDisplayCustomized={mapDisplayCustomized}
        liveSharingOpen={isLiveSharingOpen}
        liveRecipientCount={liveSharingForCurrentUser.recipientIds.length}
        liveConnectionState={liveSharingForCurrentUser.connection}
        withNavigation
        onRecenterMap={handleRecenterMap}
        onFitProjection={handleFitProjection}
        onToggleLiveSharing={() => { setIsMapOptionsOpen(false); setIsWindProfileOpen(false); setIsLiveSharingOpen((open) => !open); }}
        onToggleMapOptions={() => {
          setIsLiveSharingOpen(false);
          setIsWindProfileOpen(false);
          setIsMapOptionsOpen((isOpen) =>
            getMapOptionsOpenAfterAction(isOpen, "TOGGLE"),
          );
        }}
        onStartTracking={handleStartTracking}
        onStopTracking={handleStopFlightControl}
      />

      {!flightControlActive && !recoverableFlight && !completedFlight && (
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
          <FloatingPanel
            surface="overlay"
            style={{
              width: "min(100%, 380px)",
            }}
          >
            <h2 style={{ fontSize: "23px", fontWeight: 950 }}>
              Arrêter et enregistrer ce vol
            </h2>
            <div style={{ display: "grid", gap: "10px", marginTop: "20px" }}>
              <Button
                variant="secondary"
                disabled={flightActionBusy}
                onClick={() => setStopConfirmationOpen(false)}
                fullWidth
              >
                CONTINUER LE VOL
              </Button>
              <Button
                variant="danger"
                disabled={flightActionBusy}
                onClick={() => void handleConfirmStopTracking()}
                fullWidth
              >
                ARRÊTER ET ENREGISTRER
              </Button>
            </div>
          </FloatingPanel>
        </div>
      )}

      {flightSession.recovery.interruptedFlight && (
        <FlightRecoveryDialog
          flight={flightSession.recovery.interruptedFlight}
          busy={flightActionBusy}
          onResume={resumeInterruptedFlight}
          onComplete={() => void handleCompleteInterruptedFlight()}
          onIgnore={ignoreInterruptedFlight}
        />
      )}

      {flightSession.recovery.completedFlight && (
        <RecordedFlightScreen
          flight={flightSession.recovery.completedFlight}
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

      {selectedAirspace && (
        <AirspaceDetails
          airspace={selectedAirspace}
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
