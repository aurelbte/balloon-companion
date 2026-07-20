"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface PreparationMapProps {
  terrain?: string;
}

/**
 * Composant de carte interactive pour la préparation de vol
 * Affiche le terrain de décollage sur une carte MapLibre GL
 */
export default function PreparationMap({ terrain = "Bondues" }: PreparationMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  // Coordonnées simulées pour Bondues, France
  const longitude = 3.058;
  const latitude = 50.631;
  const zoom = 12;

  useEffect(() => {
    // Ne pas recréer la carte si elle existe déjà
    if (map.current || !mapContainer.current) {
      return;
    }

    // Initialiser la carte avec un style public (OpenStreetMap)
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [longitude, latitude],
      zoom: zoom,
      pitch: 0,
      bearing: 0,
    });

    // Ajouter les contrôles de navigation (zoom + rotation)
    map.current.addControl(new maplibregl.NavigationControl());

    // Ajouter un marqueur pour le terrain de décollage
    const marker = new maplibregl.Marker({
      color: "#f59e42", // Couleur accent orange du Design System
      draggable: false,
    })
      .setLngLat([longitude, latitude])
      .addTo(map.current);

    // Ajouter une popup au marqueur
    const popup = new maplibregl.Popup({ offset: 25 }).setText(
      `${terrain}\nPosition de décollage simulée`
    );
    marker.setPopup(popup);

    markerRef.current = marker;

    // Cleanup au démontage
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
        markerRef.current = null;
      }
    };
  }, [terrain, longitude, latitude, zoom]);

  return (
    <div className="relative overflow-hidden rounded-lg border" style={{
      borderColor: "var(--bc-border)",
      height: "420px",
      width: "100%",
    }}>
      {/* Conteneur de la carte */}
      <div
        ref={mapContainer}
        style={{
          width: "100%",
          height: "100%",
        }}
      />

      {/* Badge de simulation */}
      <div
        className="absolute bottom-4 left-4 rounded-lg px-3 py-2 text-xs font-semibold"
        style={{
          background: "rgba(7, 17, 31, 0.9)",
          color: "var(--bc-warning)",
          border: "1px solid var(--bc-border)",
        }}
      >
        Position de décollage simulée
      </div>
    </div>
  );
}
