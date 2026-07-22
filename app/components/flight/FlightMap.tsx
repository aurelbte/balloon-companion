"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoPoint, ProjectionPoint } from "../../types/flight";

interface FlightMapProps {
  currentPosition: GeoPoint | null;
  flightPoints: GeoPoint[];
  gpsProjection: ProjectionPoint[];
  weatherProjection: ProjectionPoint[];
  showGpsProjection: boolean;
  showWeatherProjection: boolean;
  onMapReady?: (map: maplibregl.Map) => void;
}

function buildFlightTrackData(points: GeoPoint[]): GeoJSON.FeatureCollection {
  if (points.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const takeoff = points[0];
  const features: GeoJSON.Feature[] = [
    {
      type: "Feature",
      properties: { kind: "takeoff" },
      geometry: {
        type: "Point",
        coordinates: [takeoff.longitude, takeoff.latitude],
      },
    },
  ];

  if (points.length > 1) {
    features.unshift({
      type: "Feature",
      properties: { kind: "track" },
      geometry: {
        type: "LineString",
        coordinates: points.map((point) => [point.longitude, point.latitude]),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

export default function FlightMap({
  currentPosition,
  flightPoints,
  gpsProjection,
  weatherProjection,
  showGpsProjection,
  showWeatherProjection,
  onMapReady,
}: FlightMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const sourceRef = useRef<boolean>(false);
  const onMapReadyRef = useRef(onMapReady);
  const flightPointsRef = useRef(flightPoints);

useEffect(() => {
  onMapReadyRef.current = onMapReady;
}, [onMapReady]);

  useEffect(() => {
    flightPointsRef.current = flightPoints;
  }, [flightPoints]);

  // Initialiser la carte
  useEffect(() => {
    if (map.current || !mapContainer.current) {
      return;
    }

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
  version: 8,
  sources: {
    "osm-tiles": {
      type: "raster",
      tiles: [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm-tiles",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
},
      center: [3.058, 50.631],
      zoom: 12,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    // Ajouter les contrôles de navigation
    map.current.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
      }),
      "bottom-right"
    );

    // Ajouter une source pour les projections
    map.current.on("load", () => {
      if (!map.current) return;

      map.current.addSource("flight-track-source", {
        type: "geojson",
        data: buildFlightTrackData(flightPointsRef.current),
      });

      map.current.addLayer({
        id: "flight-track-line",
        type: "line",
        source: "flight-track-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#f59e42",
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });

      map.current.addLayer({
        id: "flight-takeoff-point",
        type: "circle",
        source: "flight-track-source",
        filter: ["==", ["get", "kind"], "takeoff"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#22c55e",
          "circle-stroke-color": "#f4f7fb",
          "circle-stroke-width": 2,
        },
      });

      // Source pour les projections GPS
      map.current.addSource("gps-projection-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      // Couche de ligne pour la projection GPS
      map.current.addLayer({
        id: "gps-projection-line",
        type: "line",
        source: "gps-projection-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#10b981",
          "line-width": 3,
          "line-opacity": 0.7,
        },
      });

      // Couche de points pour la projection GPS
      map.current.addLayer({
        id: "gps-projection-points",
        type: "circle",
        source: "gps-projection-source",
        paint: {
          "circle-radius": 5,
          "circle-color": "#10b981",
          "circle-opacity": 0.8,
        },
      });

      // Source pour les projections météo
      map.current.addSource("weather-projection-source", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      // Couche de ligne pour la projection météo (pointillée)
      map.current.addLayer({
        id: "weather-projection-line",
        type: "line",
        source: "weather-projection-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#3b82f6",
          "line-width": 2,
          "line-dasharray": [5, 5],
          "line-opacity": 0.6,
        },
      });

      // Couche de points pour la projection météo
      map.current.addLayer({
        id: "weather-projection-points",
        type: "circle",
        source: "weather-projection-source",
        paint: {
          "circle-radius": 4,
          "circle-color": "#3b82f6",
          "circle-opacity": 0.7,
        },
      });

      sourceRef.current = true;
      onMapReadyRef.current?.(map.current);
    });

    // Cleanup au démontage
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
        markerRef.current = null;
        sourceRef.current = false;
      }
    };
  }, []);

  // Mettre à jour la position du marqueur et centrer la carte
  useEffect(() => {
    if (!map.current) return;
    if (!currentPosition) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    // Créer ou mettre à jour le marqueur
    if (markerRef.current) {
      markerRef.current.setLngLat([currentPosition.longitude, currentPosition.latitude]);
      const markerContainer = markerRef.current.getElement();
      const accuracyHalo = markerContainer.querySelector<HTMLElement>(
        "[data-accuracy-halo]"
      );
      if (accuracyHalo) {
        accuracyHalo.style.transform = `scale(${Math.min(
          1.35,
          Math.max(0.75, (currentPosition.accuracy ?? 20) / 20)
        )})`;
      }
      const arrow = markerContainer.querySelector("svg");
      if (arrow) {
        arrow.style.transform = `rotate(${currentPosition.heading ?? 0}deg)`;
      }
    } else {
      // Créer un élément pour le marqueur (flèche SVG)
      const el = document.createElement("div");
      el.style.width = "52px";
      el.style.height = "52px";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      const accuracyScale = Math.min(
        1.35,
        Math.max(0.75, (currentPosition.accuracy ?? 20) / 20)
      );
      el.innerHTML = `
        <div
          data-accuracy-halo
          style="width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(245, 158, 66, 0.14); border: 1px solid rgba(245, 158, 66, 0.38); transform: scale(${accuracyScale}); transition: transform 0.25s ease;"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff7ed"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.75)); transform: rotate(${currentPosition.heading ?? 0}deg); transition: transform 0.2s ease;"
          >
            <path d="M12 2L17 20L12 16L7 20L12 2Z"/>
          </svg>
        </div>
      `;

      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([currentPosition.longitude, currentPosition.latitude])
        .addTo(map.current);
    }

    
  }, [currentPosition]);

  useEffect(() => {
    if (!map.current || !sourceRef.current) return;
    const source = map.current.getSource("flight-track-source") as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(buildFlightTrackData(flightPoints));
  }, [flightPoints]);

  // Mettre à jour les projections GPS
  useEffect(() => {
    if (!map.current || !sourceRef.current) return;

    const source = map.current.getSource("gps-projection-source") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    if (showGpsProjection && gpsProjection.length > 0 && currentPosition) {
      // Créer une ligne et des points pour la projection
      const coordinates = [
        [currentPosition.longitude, currentPosition.latitude],
        ...gpsProjection.map((p) => [p.longitude, p.latitude]),
      ];

      const features = [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates,
          },
          properties: { type: "line" },
        },
        ...gpsProjection.map((p) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [p.longitude, p.latitude],
          },
          properties: { minutes: p.minutes },
        })),
      ];

      source.setData({
        type: "FeatureCollection",
        features,
      });

      // Afficher les couches
      if (map.current.getLayer("gps-projection-line")) {
        map.current.setLayoutProperty("gps-projection-line", "visibility", "visible");
      }
      if (map.current.getLayer("gps-projection-points")) {
        map.current.setLayoutProperty("gps-projection-points", "visibility", "visible");
      }
    } else {
      // Masquer les couches
      if (map.current.getLayer("gps-projection-line")) {
        map.current.setLayoutProperty("gps-projection-line", "visibility", "none");
      }
      if (map.current.getLayer("gps-projection-points")) {
        map.current.setLayoutProperty("gps-projection-points", "visibility", "none");
      }
    }
  }, [currentPosition, gpsProjection, showGpsProjection]);

  // Mettre à jour les projections météo
  useEffect(() => {
    if (!map.current || !sourceRef.current) return;

    const source = map.current.getSource("weather-projection-source") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    if (
      showWeatherProjection &&
      weatherProjection.length > 0 &&
      currentPosition
    ) {
      // Créer une ligne et des points pour la projection
      const coordinates = [
        [currentPosition.longitude, currentPosition.latitude],
        ...weatherProjection.map((p) => [p.longitude, p.latitude]),
      ];

      const features = [
        {
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates,
          },
          properties: { type: "line" },
        },
        ...weatherProjection.map((p) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [p.longitude, p.latitude],
          },
          properties: { minutes: p.minutes },
        })),
      ];

      source.setData({
        type: "FeatureCollection",
        features,
      });

      // Afficher les couches
      if (map.current.getLayer("weather-projection-line")) {
        map.current.setLayoutProperty("weather-projection-line", "visibility", "visible");
      }
      if (map.current.getLayer("weather-projection-points")) {
        map.current.setLayoutProperty("weather-projection-points", "visibility", "visible");
      }
    } else {
      // Masquer les couches
      if (map.current.getLayer("weather-projection-line")) {
        map.current.setLayoutProperty("weather-projection-line", "visibility", "none");
      }
      if (map.current.getLayer("weather-projection-points")) {
        map.current.setLayoutProperty("weather-projection-points", "visibility", "none");
      }
    }
  }, [currentPosition, weatherProjection, showWeatherProjection]);

  return <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />;
}
