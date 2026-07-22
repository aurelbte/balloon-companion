"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { useGeolocation } from "../hooks/useGeolocation";
import { useFlightTracking } from "../hooks/useFlightTracking";
import {
  buildGpsProjectionPoints,
  buildWeatherProjectionPoints,
} from "../lib/geo";
import FlightMap from "../components/flight/FlightMap";
import FlightInstruments from "../components/flight/FlightInstruments";
import FlightControls from "../components/flight/FlightControls";
import LayersPanel from "../components/flight/LayersPanel";
import type {
  BaseMap,
  FlightLayerSettings,
  ProjectionPoint,
} from "../types/flight";

export default function FlightPage() {
  const [layerSettings, setLayerSettings] = useState<FlightLayerSettings>({
    gpsProjection: true,
    weatherProjection: false,
    airspaces: false,
    aeronauticalMap: false,
    highContrast: false,
  });

  const [isLayersPanelOpen, setIsLayersPanelOpen] = useState(false);
  const [baseMap, setBaseMap] = useState<BaseMap>("plan");
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const satelliteConfigured = Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY);

  // Géolocalisation
  const {
    point: currentPosition,
    state: geoState,
    error: geoError,
    isStale,
    requestPermission,
    stopTracking: stopGeolocation,
  } = useGeolocation({
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 10000,
    enableDevelopmentTestMode: true,
  });

  // Suivi du vol
  const {
    isTracking,
    points,
    metrics,
    startTracking,
    stopTracking,
    addPoint,
    status: flightStatus,
    hasSavedFlight,
    markAcquiring,
    markReady,
  } = useFlightTracking();

  // Ajouter un point à chaque mise à jour GPS
  useEffect(() => {
    if (isTracking && currentPosition && !isStale) {
      addPoint(currentPosition);
    }
  }, [isTracking, currentPosition, isStale, addPoint]);

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
      currentPosition.speed <= 0.5
    ) {
      return [];
    }

    return buildGpsProjectionPoints(
      currentPosition.latitude,
      currentPosition.longitude,
      currentPosition.heading,
      currentPosition.speed
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
      currentPosition.speed as number
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
    if (mapRef.current && currentPosition) {
      mapRef.current.flyTo({
        center: [currentPosition.longitude, currentPosition.latitude],
        zoom: 14,
        duration: 500,
      });
    }
  }, [currentPosition]);

  const handleFitProjection = useCallback(() => {
    if (!mapRef.current || !currentPosition) return;

    const allPoints: Array<[number, number]> = [
      [currentPosition.longitude, currentPosition.latitude],
    ];

    if (layerSettings.gpsProjection) {
      allPoints.push(
        ...gpsProjection.map((p) => [p.longitude, p.latitude] as [number, number])
      );
    }

    if (layerSettings.weatherProjection) {
      allPoints.push(
        ...weatherProjection.map((p) => [p.longitude, p.latitude] as [number, number])
      );
    }

    if (allPoints.length === 1) return;

    // Calculer les limites
    const lngs = allPoints.map((p) => p[0]);
    const lats = allPoints.map((p) => p[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    mapRef.current.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: 50,
        duration: 500,
      }
    );
  }, [currentPosition, gpsProjection, weatherProjection, layerSettings]);

  const handleStartTracking = useCallback(() => {
    if ((geoState === "active" || geoState === "simulation") && !isStale) {
      if (
        flightStatus === "stopped" &&
        hasSavedFlight &&
        !window.confirm(
          "Commencer un nouveau vol et remplacer la session arrêtée ?"
        )
      ) {
        return;
      }
      startTracking();
    } else {
      markAcquiring();
      requestPermission();
    }
  }, [
    flightStatus,
    geoState,
    hasSavedFlight,
    isStale,
    markAcquiring,
    requestPermission,
    startTracking,
  ]);

  const handleStopTracking = useCallback(() => {
    if (window.confirm("Arrêter et sauvegarder l’enregistrement du vol ?")) {
      stopTracking();
      stopGeolocation();
    }
  }, [stopGeolocation, stopTracking]);

  const handleBaseMapChange = useCallback(
    (nextBaseMap: BaseMap) => {
      if (nextBaseMap === "satellite" && !satelliteConfigured) return;
      setBaseMap(nextBaseMap);
    },
    [satelliteConfigured]
  );

  const handleSatelliteError = useCallback((message: string) => {
    setBaseMap("plan");
    setSatelliteError(message);
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

  const gpsStatus = (() => {
    if (geoState === "simulation") return "MODE TEST • GPS SIMULÉ";
    if (geoState === "permission_denied") return "GPS REFUSÉ";
    if (geoState === "unavailable" || geoState === "error") {
      return "GPS INDISPONIBLE";
    }
    if (geoState === "idle" && flightStatus === "stopped") return "GPS ARRÊTÉ";
    if (isStale) return "POSITION ANCIENNE";
    if (
      geoState === "active" &&
      currentPosition &&
      currentPosition.accuracy !== null
    ) {
      return `GPS ACTIF · ±${Math.round(currentPosition.accuracy)} m`;
    }
    return "RECHERCHE GPS";
  })();

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
          showGpsProjection={layerSettings.gpsProjection && isTracking}
          showWeatherProjection={layerSettings.weatherProjection && isTracking}
          onSatelliteError={handleSatelliteError}
          onMapReady={(map) => {
            mapRef.current = map;
          }}
        />
      </div>

      {/* Panneau d'instruments */}
      <FlightInstruments
        metrics={displayedMetrics}
        isRecording={isTracking}
        highContrast={layerSettings.highContrast}
        geolocationState={geoState}
      />

      <div
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          top: "max(16px, env(safe-area-inset-top))",
          right: "16px",
          zIndex: 20,
          padding: "9px 11px",
          borderRadius: "12px",
          background: "rgba(7, 17, 31, 0.9)",
          border: "1px solid rgba(255, 255, 255, 0.18)",
          color:
            (geoState === "active" || geoState === "simulation") && !isStale
              ? "var(--bc-success)"
              : "var(--bc-warning)",
          fontSize: "11px",
          fontWeight: 800,
          letterSpacing: "0.04em",
        }}
      >
        {gpsStatus}
      </div>

      {/* Boutons flottants */}
      <FlightControls
        isTracking={isTracking}
        onRecenterMap={handleRecenterMap}
        onFitProjection={handleFitProjection}
        onOpenLayers={() => setIsLayersPanelOpen(true)}
        onStartTracking={handleStartTracking}
        onStopTracking={handleStopTracking}
      />

      {/* Panneau des couches */}
      <LayersPanel
        isOpen={isLayersPanelOpen}
        settings={layerSettings}
        baseMap={baseMap}
        satelliteAvailable={satelliteConfigured && satelliteError === null}
        satelliteMessage={
          satelliteError ??
          (!satelliteConfigured
            ? "Fond satellite non configuré"
            : null)
        }
        onBaseMapChange={handleBaseMapChange}
        onSettingsChange={setLayerSettings}
        onClose={() => setIsLayersPanelOpen(false)}
      />

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
    </div>
  );
}
