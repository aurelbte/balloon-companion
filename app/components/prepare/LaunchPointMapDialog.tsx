"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LocateFixed, Navigation, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeocodingResult } from "../../lib/trajectory/integration";

type LaunchPointMapDialogProps = {
  initialPoint: GeocodingResult;
  onCancel: () => void;
  onConfirm: (point: GeocodingResult) => void;
  title?: string;
  instruction?: string;
  confirmLabel?: string;
};

export default function LaunchPointMapDialog({
  initialPoint,
  onCancel,
  onConfirm,
  title = "Point de décollage",
  instruction = "Touchez la carte ou déplacez le marqueur",
  confirmLabel = "Valider ce point",
}: LaunchPointMapDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
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
    markerRef.current = marker;
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
      markerRef.current = null;
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
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p
            className="mt-0.5 text-[10px]"
            style={{ color: "var(--bc-color-text-muted)" }}
          >
            {instruction}
          </p>
        </div>
        <span className="h-11 w-11" />
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        <div className="absolute right-3 top-3 z-10 grid gap-2">
          <button type="button" onClick={() => mapRef.current?.easeTo({ center: [coordinates.longitude, coordinates.latitude], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 250 })} className="grid h-11 w-11 place-items-center rounded-full border bg-[var(--bc-color-canvas-elevated)]" style={{ borderColor: "var(--bc-border)" }} aria-label="Recentrer sur le point choisi"><Navigation size={18} /></button>
          <button type="button" onClick={() => navigator.geolocation?.getCurrentPosition((position) => { const next = { latitude: position.coords.latitude, longitude: position.coords.longitude }; setCoordinates(next); markerRef.current?.setLngLat([next.longitude, next.latitude]); mapRef.current?.easeTo({ center: [next.longitude, next.latitude], zoom: 15, duration: 250 }); })} className="grid h-11 w-11 place-items-center rounded-full border bg-[var(--bc-color-canvas-elevated)]" style={{ borderColor: "var(--bc-border)" }} aria-label="Utiliser ma position"><LocateFixed size={18} /></button>
        </div>
      </div>

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
          <Check size={18} /> {confirmLabel}
        </button>
      </footer>
    </div>
  );
}
