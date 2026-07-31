"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeocodingResult } from "../../lib/trajectory/integration";

type LaunchPointMapDialogProps = {
  initialPoint: GeocodingResult;
  onCancel: () => void;
  onConfirm: (point: GeocodingResult) => void;
  /** Point d'extension pour la future création d'un favori. */
  onRequestSaveFavorite?: (point: GeocodingResult) => void;
};

export default function LaunchPointMapDialog({
  initialPoint,
  onCancel,
  onConfirm,
}: LaunchPointMapDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [coordinates, setCoordinates] = useState({
    latitude: initialPoint.latitude,
    longitude: initialPoint.longitude,
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>',
          },
        },
        layers: [{ id: "plan-base", type: "raster", source: "osm-tiles" }],
      },
      center: [initialPoint.longitude, initialPoint.latitude],
      zoom: 14,
      attributionControl: { compact: true },
    });
    const marker = new maplibregl.Marker({
      color: "#55b889",
      draggable: true,
    })
      .setLngLat([initialPoint.longitude, initialPoint.latitude])
      .addTo(map);
    const updateCoordinates = (longitude: number, latitude: number) => {
      marker.setLngLat([longitude, latitude]);
      setCoordinates({ longitude, latitude });
    };
    marker.on("dragend", () => {
      const point = marker.getLngLat();
      setCoordinates({ longitude: point.lng, latitude: point.lat });
    });
    map.on("click", (event) => {
      updateCoordinates(event.lngLat.lng, event.lngLat.lat);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [initialPoint.latitude, initialPoint.longitude]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-[var(--bc-color-canvas)]">
      <header
        className="flex items-center justify-between border-b px-3 pb-2 pt-[max(8px,env(safe-area-inset-top))]"
        style={{ borderColor: "var(--bc-border)" }}
      >
        <button
          type="button"
          onClick={onCancel}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          aria-label="Annuler la sélection"
        >
          <X size={20} />
        </button>
        <div className="min-w-0 px-2 text-center">
          <h2 className="truncate text-sm font-semibold">Point de décollage</h2>
          <p
            className="mt-0.5 text-[10px]"
            style={{ color: "var(--bc-color-text-muted)" }}
          >
            Touchez la carte ou déplacez le marqueur
          </p>
        </div>
        <span className="h-11 w-11" />
      </header>

      <div ref={containerRef} className="min-h-0 flex-1" />

      <footer
        className="border-t px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3"
        style={{
          background: "var(--bc-color-canvas-elevated)",
          borderColor: "var(--bc-border)",
        }}
      >
        <p
          className="mb-3 text-center font-mono text-[11px]"
          style={{ color: "var(--bc-color-text-secondary)" }}
        >
          {coordinates.latitude.toFixed(6)} · {coordinates.longitude.toFixed(6)}
        </p>
        <button
          type="button"
          onClick={() =>
            onConfirm({
              ...initialPoint,
              id: `precise-${coordinates.latitude}-${coordinates.longitude}`,
              latitude: coordinates.latitude,
              longitude: coordinates.longitude,
            })
          }
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-semibold"
          style={{
            background: "var(--bc-accent)",
            color: "var(--bc-accent-foreground)",
          }}
        >
          <Check size={18} /> Valider ce point
        </button>
      </footer>
    </div>
  );
}
