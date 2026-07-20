"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
  const [gpsProjection, setGpsProjection] = useState<ProjectionPoint[]>([]);
  const [weatherProjection, setWeatherProjection] = useState<ProjectionPoint[]>([]);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Géolocalisation
  const { point: currentPosition, state: geoState, error: geoError, requestPermission } =
    useGeolocation({
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
      simulateIfUnavailable: false,
    });

  // Suivi du vol
  const {
    isTracking,
    metrics,
    startTracking,
    stopTracking,
    addPoint,
    reset,
  } = useFlightTracking();

  // Ajouter un point à chaque mise à jour GPS
  useEffect(() => {
    if (isTracking && currentPosition) {
      addPoint(currentPosition);
    }
  }, [isTracking, currentPosition, addPoint]);

  // Calculer les projections GPS et météo
  useEffect(() => {
    if (!currentPosition || (currentPosition.speed || 0) <= 0.5) {
      if (gpsProjection.length > 0 || weatherProjection.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setGpsProjection([]);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setWeatherProjection([]);
      }
      return;
    }

    const gps = buildGpsProjectionPoints(
      currentPosition.latitude,
      currentPosition.longitude,
      currentPosition.heading || 0,
      currentPosition.speed || 0
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGpsProjection(gps);

    if (layerSettings.weatherProjection) {
      const weather = buildWeatherProjectionPoints(
        currentPosition.latitude,
        currentPosition.longitude,
        currentPosition.heading || 0,
        currentPosition.speed || 0
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWeatherProjection(weather);
    }
  }, [currentPosition, layerSettings.weatherProjection]);

  // Demander la permission au premier rendu
  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

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
    if (geoState === "active" || geoState === "simulation") {
      reset();
      startTracking();
    } else {
      requestPermission();
    }
  }, [geoState, reset, startTracking, requestPermission]);

  const handleStopTracking = useCallback(() => {
    stopTracking();
  }, [stopTracking]);

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
      <<div
  style={{
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    zIndex: 0,
  }}
>
        }}
      >
        <FlightMap
          currentPosition={currentPosition}
          gpsProjection={gpsProjection}
          weatherProjection={weatherProjection}
          showGpsProjection={layerSettings.gpsProjection && isTracking}
          showWeatherProjection={layerSettings.weatherProjection && isTracking}
          onMapReady={(map) => {
            mapRef.current = map;
          }}
        />
      </div>

      {/* Panneau d'instruments */}
      <FlightInstruments
        metrics={metrics}
        isRecording={isTracking}
        highContrast={layerSettings.highContrast}
        geolocationState={geoState}
      />

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
        onSettingsChange={setLayerSettings}
        onClose={() => setIsLayersPanelOpen(false)}
      />

      {/* Indicateur d'erreur GPS */}
      {geoError && geoState !== "simulation" && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            left: "16px",
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
