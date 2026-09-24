"use client";
import { authorizeWeatherLaunch, launchNeedsWeatherConfirmation } from "../lib/weather/weatherLaunch";
import { getTrajectoryAnalysisRequest } from "../lib/trajectory/projectionStorage";
import { refreshCurrentWeatherAnalysis } from "../lib/trajectory/refreshWeatherAnalysis";
import { DATA_SCOPE_CHANGED_EVENT, getRuntimeDataScope, getRuntimeDataScopeGeneration } from "../lib/auth/dataScopeRuntime";
import { ANALYSIS_POLICY, classifyWeatherFreshness, freshnessLabel, retrievalLabel, type WeatherFreshness } from "../lib/weather/weatherFreshness";
import { useWeatherFreshness } from "../hooks/useWeatherFreshness";
import { refreshStorageEstimate } from "../lib/storageResilience";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { navigateToFlightCompletion } from "../lib/flightCompletionNavigation";
import { useFlightRuntime } from "../contexts/FlightRuntimeContext";
import { useSelectedAirspace } from "../hooks/useSelectedAirspace";
import { useFlightContext } from "../hooks/useFlightContext";
import { useAirspaceCoverage, type AirspaceCoverageViewport } from "../hooks/useAirspaceCoverage";
import {
  buildGpsProjectionPoints,
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
  type ExportedPlannedTrajectory,
  type FlightWeatherSnapshot,
} from "../lib/trajectory/weatherAnalysisStorage";
import { Button, FloatingPanel } from "../design-system";
import { createFlightSession } from "../lib/flightCore";
import { aggregateObservedWind, snapshotWindProfile } from "../lib/flightWindProfile";
import { loadValidatedFlightWeather, selectFlightWeatherSnapshot } from "../lib/flightWeatherValidation";
import { loadPreparationDraft } from "../lib/preparationDraftStorage";
import { loadAviationPreferences } from "../lib/aviation/aviationPreferencesStorage";
import { qnhHpaFromMetar } from "../weather/aviationPresentation";
import type { AviationWeather } from "../lib/aviation/types";
import { aviationFreshness, retainStaleAviation } from "../lib/aviation/aviationFreshness";
import { startCockpitAviationRefresh } from "../lib/aviation/cockpitAviationRefresh";
import { useBalloonAuth } from "../contexts/AuthContext";
import LiveFlightSimulatorPanel from "../components/flight/LiveFlightSimulatorPanel";
import type { SharedPilotMapEntry } from "../lib/liveFlightMap.ts";
import LiveSharingPanel from "../components/flight/LiveSharingPanel";
import { loadFriendsSnapshot, type FriendProfile } from "../lib/friends.ts";
import { createBrowserSupabaseClient } from "../lib/supabase/client.ts";
import { EMPTY_LIVE_SHARING_UI_STATE, stopLiveSharingUi, type LiveSharingUiState } from "../lib/liveFlightUi.ts";
import { LiveFlightRuntime, type LivePositionSource } from "../lib/liveFlightRuntime.ts";
import { canUseLiveFlightPublisherControls, shouldPublishTrackedLiveSource, shouldRequestLocalFlightGeolocationOnMount, shouldStartGpslessTargetedLiveFlight } from "../lib/liveFlightSimulator.ts";
import { useBalloonRegistry } from "../hooks/useBalloons.ts";

export default function FlightPage() {
  const router = useRouter();
  const auth = useBalloonAuth();
  const balloonRegistry = useBalloonRegistry();
  const currentUserId = auth.state === "SIGNED_IN" ? (auth.user?.id ?? null) : null;
  const shouldRequestLocalGeolocation = typeof window === "undefined"
    ? true
    : shouldRequestLocalFlightGeolocationOnMount(window.location.search);
  const completionPath = (flightId?: string) => {
    const current = new URLSearchParams(window.location.search);
    const target = new URLSearchParams();
    if (flightId) target.set("flightId", flightId);
    if (current.get("cloudSyncTest") === "targeted") target.set("cloudSyncTest", "targeted");
    if (current.get("demo") === "1") target.set("demo", "1");
    const query = target.toString();
    return `/flight/complete${query ? `?${query}` : ""}`;
  };
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
  const [weatherLaunchConfirmation, setWeatherLaunchConfirmation] = useState<{ snapshot: FlightWeatherSnapshot | null; status: WeatherFreshness; resolve: (accepted: boolean) => void } | null>(null);
  const weatherDecisionRef = useRef<((accepted: boolean) => void) | null>(null);
  const weatherLaunchBusyRef = useRef(false);
  const weatherLaunchMountedRef = useRef(false);
  const [weatherLaunchNotice, setWeatherLaunchNotice] = useState<string | null>(null);
  useEffect(() => {
    weatherLaunchMountedRef.current = true;
    const invalidate = () => { weatherDecisionRef.current?.(false); weatherDecisionRef.current = null; setWeatherLaunchConfirmation(null); setWeatherLaunchNotice(null); };
    window.addEventListener(DATA_SCOPE_CHANGED_EVENT, invalidate);
    return () => { weatherLaunchMountedRef.current = false; window.removeEventListener(DATA_SCOPE_CHANGED_EVENT, invalidate); weatherDecisionRef.current?.(false); };
  }, []);
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
  const [qnhWeather, setQnhWeather] = useState<AviationWeather | null>(null);
  const [qnhNow, setQnhNow] = useState<number | null>(null);
  const qnhFreshness = qnhWeather && qnhNow !== null ? aviationFreshness(qnhWeather, "metar", qnhNow) : null;
  const lastQnhHpa = qnhHpaFromMetar(qnhWeather?.metarRaw ?? null);
  const qnhHpa = qnhFreshness?.usable ? lastQnhHpa : null;
  const qnhIssuedAt = Date.parse(qnhWeather?.metarIssuedAt ?? "");
  const qnhAgeMinutes = qnhNow !== null && Number.isFinite(qnhIssuedAt) && qnhIssuedAt <= qnhNow ? Math.floor((qnhNow - qnhIssuedAt) / 60_000) : null;
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
    let timer: number;
    const refresh = () => {
      window.clearTimeout(timer);
      const weather = loadValidatedFlightWeather();
      setPlannedTrajectories(weather.trajectories);
      setValidatedWeatherSnapshot(weather.snapshot);
      const delay = weather.validUntil === null ? 60_000 : Math.min(60_000, Math.max(1, weather.validUntil - Date.now()));
      timer = window.setTimeout(refresh, delay);
    };
    const foreground = () => { if (document.visibilityState === "visible") refresh(); };
    timer = window.setTimeout(refresh, 0);
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!demoFlightEnding) return;
    const timer = window.setTimeout(() => router.push(completionPath()), 850);
    return () => window.clearTimeout(timer);
  }, [demoFlightEnding, router]);

  useEffect(() => {
    const airport = loadAviationPreferences()?.airportIcao ?? null;
    if (!airport) return;
    return startCockpitAviationRefresh(airport, {
      onClock: setQnhNow,
      onResult: (result) => setQnhWeather((previous) => result.data ?? retainStaleAviation(previous, airport)),
      onFailure: () => setQnhWeather((previous) => retainStaleAviation(previous, airport)),
    });
  }, []);

  const { geolocation, tracking } = useFlightRuntime();
  const {
    point: currentPosition,
    state: geoState,
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
  const latestLaunchPositionRef = useRef<{ position: typeof currentPosition; available: boolean; recording: boolean } | null>(null);
  useEffect(() => { latestLaunchPositionRef.current = { position: currentPosition, recording: isTracking || activeFlight !== null, available: (geoState === "active" || geoState === "simulation") && !isStale && currentPosition !== null }; }, [currentPosition, geoState, isStale, isTracking, activeFlight]);
  const weatherFlightAlreadyActive = isTracking || activeFlight !== null;
  useEffect(() => {
    if (!weatherFlightAlreadyActive) return;
    const timer = setTimeout(() => { weatherDecisionRef.current?.(false); weatherDecisionRef.current = null; setWeatherLaunchConfirmation(null); }, 0);
    return () => clearTimeout(timer);
  }, [weatherFlightAlreadyActive]);
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

  // Aucun moteur météo cockpit réel : ne produire ni afficher de projection simulée.
  const weatherProjection = useMemo<ProjectionPoint[]>(() => [], []);

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

  const handleStartTracking = useCallback(async () => {
    if (!storageReady || isTracking || activeFlight || weatherLaunchBusyRef.current) return;
    // Best effort only: the actual IndexedDB commit remains the start authority.
    void refreshStorageEstimate();
    const hasFreshLocalPosition = (geoState === "active" || geoState === "simulation") && !isStale && currentPosition !== null;
    if (shouldStartGpslessTargetedLiveFlight(window.location.search, hasFreshLocalPosition)) {
      setTargetedLiveTestFlightActive(true);
      return;
    }
    if (hasFreshLocalPosition) {
      const preparation = loadPreparationDraft();
      const selectedBalloonId = preparation?.balloonName;
      const selectedBalloon = balloonRegistry.balloons.find(({ id }) => id === selectedBalloonId);
      weatherLaunchBusyRef.current = true;
      const scope = getRuntimeDataScope(), generation = getRuntimeDataScopeGeneration();
      const preparationIdentity = JSON.stringify(preparation), requestIdentity = JSON.stringify(getTrajectoryAnalysisRequest()?.request);
      const current = () => weatherLaunchMountedRef.current && !latestLaunchPositionRef.current?.recording && getRuntimeDataScope() === scope && getRuntimeDataScopeGeneration() === generation && JSON.stringify(loadPreparationDraft()) === preparationIdentity && JSON.stringify(getTrajectoryAnalysisRequest()?.request) === requestIdentity;
      try {
        let refreshFailed = false;
        setWeatherLaunchNotice(navigator.onLine ? "Vérification des données météo…" : "Hors ligne — actualisation impossible.");
        const launchOptions = {
          read: () => loadValidatedFlightWeather().snapshot,
          refresh: async () => {
            const refreshed = await refreshCurrentWeatherAnalysis();
            refreshFailed = !refreshed;
            if (current()) setWeatherLaunchNotice(refreshed ? "Données météo actualisées." : "Actualisation impossible.");
            return refreshed;
          },
          online: () => navigator.onLine,
          current,
          confirm: (snapshot: FlightWeatherSnapshot | null, status: WeatherFreshness) => new Promise<boolean>(resolve => {
            weatherDecisionRef.current = resolve;
            setWeatherLaunchConfirmation({ snapshot, status, resolve });
          }),
        };
        let decision = await authorizeWeatherLaunch(launchOptions);
        if (decision.allowed && !decision.confirmed && launchNeedsWeatherConfirmation(classifyWeatherFreshness(Date.now(), decision.snapshot?.weatherFetchedAt, ANALYSIS_POLICY))) decision = await authorizeWeatherLaunch({ ...launchOptions, online: () => false });
        if (!decision.allowed || !current()) { if (current()) setWeatherLaunchNotice("Lancement annulé. Les données météo n’ont pas été modifiées par la confirmation."); return; }
        const weatherSnapshot = decision.snapshot;
        setValidatedWeatherSnapshot(weatherSnapshot);
        setPlannedTrajectories(loadValidatedFlightWeather().trajectories);
        const status = classifyWeatherFreshness(Date.now(), weatherSnapshot?.weatherFetchedAt, ANALYSIS_POLICY);
        setWeatherLaunchNotice(status === "FRESH" ? null : `${freshnessLabel(status)} · ${retrievalLabel(weatherSnapshot?.weatherFetchedAt)}${refreshFailed ? " · Actualisation impossible" : !navigator.onLine ? " · Hors ligne — actualisation impossible" : ""}`);
        const latestPosition = latestLaunchPositionRef.current;
        if (!latestPosition?.available || !latestPosition.position) { setWeatherLaunchNotice("Position GPS indisponible. Réessayez le lancement lorsque le GPS est disponible."); return; }
        await startTracking(latestPosition.position, {
          ...(selectedBalloon?.registration ? { balloonRegistration: selectedBalloon.registration } : {}),
          ...(preparation?.launchTimeZone ? { timeZone: preparation.launchTimeZone } : {}),
          ...(weatherSnapshot ? { weatherModel: weatherSnapshot.weatherModel, weatherSnapshot } : {}),
        });
      } finally { weatherLaunchBusyRef.current = false; }

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
    balloonRegistry.balloons,
    isTracking,
    activeFlight,
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
      navigateToFlightCompletion(completionPath(completed.id), router);
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
  const flightWeatherSnapshot = selectFlightWeatherSnapshot(
    validatedWeatherSnapshot, activeFlight ?? recoverableFlight,
  );
  const historicalWeatherSnapshot = activeFlight ? activeFlight.weatherSnapshot ?? null : flightWeatherSnapshot;
  const historicalFreshness = useWeatherFreshness(historicalWeatherSnapshot?.weatherFetchedAt, ANALYSIS_POLICY);
  const predictedWinds = useMemo(
    () => snapshotWindProfile(historicalWeatherSnapshot),
    [historicalWeatherSnapshot],
  );
  const predictedModelLabel = historicalWeatherSnapshot?.modelLabel ?? null;

  if (auth.state === "SIGNED_OUT" && auth.authChoiceState === "AUTH_CHOICE_PENDING") return (
    <main style={{ padding: "32px 20px" }}>
      <h1>Accéder au vol local</h1>
      <p>Pour récupérer un vol effectué sans compte, réactivez le mode invité. Un vol associé à un compte nécessite ce même compte.</p>
      <Button onClick={auth.activateGuestMode}>Continuer en mode invité</Button>
    </main>
  );

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
          showWeatherProjection={false}
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
        predictedForecastAt={historicalWeatherSnapshot?.forecastAtIso ?? null}
        predictedTimeZone={historicalWeatherSnapshot?.launchTimeZone}
        predictedWeatherStatus={`${activeFlight ? "Référence historique du vol · " : ""}${freshnessLabel(historicalFreshness)} · ${retrievalLabel(historicalWeatherSnapshot?.weatherFetchedAt)} · ${historicalWeatherSnapshot?.calculatedAtIso ? `Calcul commencé le ${new Date(historicalWeatherSnapshot.calculatedAtIso).toLocaleString("fr-FR")} · ` : ""}Run du modèle inconnu`}
        onToggle={() => { setIsLiveSharingOpen(false); setIsMapOptionsOpen(false); setIsWindProfileOpen((open) => !open); }}
        onClose={() => setIsWindProfileOpen(false)}
      />
      <FlightInstruments
        session={flightSession}
        qnhStatus={qnhWeather ? `${qnhWeather.airport} · ${qnhAgeMinutes === null ? "âge inconnu" : `il y a ${qnhAgeMinutes} min`}` : "QNH Aviation indisponible"}
        staleQnhHpa={qnhFreshness?.usable ? null : lastQnhHpa}
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
        timeZone={historicalWeatherSnapshot?.launchTimeZone}
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
          onIgnore={() => { ignoreInterruptedFlight(); router.push("/"); }}
        />
      )}

      {flightSession.recovery.completedFlight && (
        <RecordedFlightScreen
          flight={flightSession.recovery.completedFlight}
          onReturn={dismissCompletedFlight}
        />
      )}

      {weatherLaunchNotice && !weatherFlightAlreadyActive && <p role="status" style={{ position: "fixed", bottom: "110px", left: "16px", zIndex: 60, background: "#101c2c", color: "white", padding: "12px" }}>{weatherLaunchNotice}</p>}
      {weatherLaunchConfirmation && !weatherFlightAlreadyActive && <div role="dialog" aria-modal="true" aria-labelledby="weather-launch-title" style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.8)", display: "grid", placeItems: "center", padding: "24px" }}>
        <section style={{ background: "#101c2c", color: "white", padding: "24px", maxWidth: "420px" }}>
          <h2 id="weather-launch-title">{weatherLaunchConfirmation.status === "EXPIRED" ? "Données météo périmées" : "La fraîcheur de ces données météo ne peut pas être vérifiée"}</h2>
          <p>{retrievalLabel(weatherLaunchConfirmation.snapshot?.weatherFetchedAt)}</p>{weatherLaunchNotice && <p>{weatherLaunchNotice}</p>}<p>Continuer avec ces données ?</p>
          <Button onClick={() => { weatherLaunchConfirmation.resolve(false); weatherDecisionRef.current = null; setWeatherLaunchConfirmation(null); }}>Annuler</Button>
          {typeof navigator !== "undefined" && navigator.onLine && <Button onClick={() => { weatherLaunchConfirmation.resolve(false); weatherDecisionRef.current = null; setWeatherLaunchConfirmation(null); router.push("/map"); }}>Actualiser l’analyse</Button>}
          <Button onClick={() => { weatherLaunchConfirmation.resolve(true); weatherDecisionRef.current = null; setWeatherLaunchConfirmation(null); }}>Continuer avec ces données</Button>
        </section>
      </div>}
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

      <NavigationBar activeItem="Vol" onNavigate={handleNavigationRequest} />
    </div>
  );
}
