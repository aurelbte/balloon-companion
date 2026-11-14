"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Check, LocateFixed, Navigation, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LAUNCH_SATELLITE_LAYER, LAUNCH_SATELLITE_SOURCE, launchSatelliteSource, setLaunchPointBaseMap, type LaunchPointBaseMap } from "../../lib/launchPointBaseMap";
import type { GeocodingResult } from "../../lib/trajectory/integration";

import { FlightPowerLineRuntime, FLIGHT_POWER_LINE_MIN_ZOOM } from "../../lib/flightPowerLines";
import type { PreparationPowerLineState } from "../../lib/preparationPowerLines";
import { preparationPowerLineStatusLabel } from "../../lib/tiledPowerLineStatus";

const POWER_SOURCE = "launch-power-lines";
const POWER_LAYERS = ["launch-power-casing", "launch-power-line"] as const;

const SATELLITE_ERROR_WINDOW_MS = 10_000;
const MAX_SATELLITE_ERRORS = 3;

type LaunchPointMapDialogProps = {
  initialPoint: GeocodingResult;
  onCancel: () => void;
  onConfirm: (point: GeocodingResult) => void;
  allowBaseMapSelection?: boolean;
  title?: string;
  instruction?: string;
  confirmLabel?: string;
};

export default function LaunchPointMapDialog({
  initialPoint,
  onCancel,
  onConfirm,
  allowBaseMapSelection = false,
  title = "Point de décollage",
  instruction = "Touchez la carte ou déplacez le marqueur",
  confirmLabel = "Valider ce point",
}: LaunchPointMapDialogProps) {
  const mapTilerKey = allowBaseMapSelection ? (process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "") : "";
  const [showPowerLines, setShowPowerLines] = useState(false);
  const [powerState, setPowerState] = useState<PreparationPowerLineState | null>(null);
  const [baseMap, setBaseMap] = useState<LaunchPointBaseMap>("plan");
  const baseMapRef = useRef<LaunchPointBaseMap>("plan");
  const [satelliteError, setSatelliteError] = useState<string | null>(null);
  const satelliteErrorsRef = useRef<number[]>([]);
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
    const satelliteSource = launchSatelliteSource(mapTilerKey);
    const restorePlan = () => {
      if (baseMapRef.current !== "satellite") return;
      baseMapRef.current = setLaunchPointBaseMap(map, "plan");
      setBaseMap("plan");
      setSatelliteError("Satellite indisponible : fond Plan restauré. Vous pouvez réessayer Satellite.");
    };
    map.on("load", () => {
      if (!satelliteSource) return;
      map.addSource(LAUNCH_SATELLITE_SOURCE, satelliteSource);
      map.addLayer({ id: LAUNCH_SATELLITE_LAYER, type: "raster", source: LAUNCH_SATELLITE_SOURCE, layout: { visibility: "none" } });
      setLaunchPointBaseMap(map, baseMapRef.current);
    });
    map.on("sourcedata", (event) => {
      if (event.sourceId === LAUNCH_SATELLITE_SOURCE && event.isSourceLoaded) satelliteErrorsRef.current = [];
    });
    map.on("error", (event) => {
      if (baseMapRef.current !== "satellite") return;
      if (!("sourceId" in event && event.sourceId === LAUNCH_SATELLITE_SOURCE) && !event.error.message.includes("api.maptiler.com")) return;
      const now = Date.now();
      satelliteErrorsRef.current = satelliteErrorsRef.current.filter(time => now - time <= SATELLITE_ERROR_WINDOW_MS).concat(now);
      if (satelliteErrorsRef.current.length >= MAX_SATELLITE_ERRORS) restorePlan();
    });
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [initialPoint.latitude, initialPoint.longitude, mapTilerKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showPowerLines) return;
    const runtime = new FlightPowerLineRuntime(state => {
      setPowerState(state);
      (map.getSource(POWER_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(state.data);
    });
    const refresh = () => {
      if (!map.getSource(POWER_SOURCE)) return;
      const bounds = map.getBounds();
      void runtime.update({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, navigator.onLine, false, true, map.getZoom());
    };
    const initialize = () => {
      if (!map.getSource(POWER_SOURCE)) {
        map.addSource(POWER_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a> · Geofabrik' });
        POWER_LAYERS.forEach((id, index) => map.addLayer({
          id, type: "line", source: POWER_SOURCE, minzoom: FLIGHT_POWER_LINE_MIN_ZOOM,
          filter: ["==", ["get", "power"], "line"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": index === 0 ? "rgba(7, 17, 31, 0.82)" : "#dc2626",
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, index === 0 ? 4.6 : 2.8, 14, index === 0 ? 7 : 4.6],
          },
        }));
      }
      for (const id of POWER_LAYERS) map.setLayoutProperty(id, "visibility", "visible");
      refresh();
    };
    if (map.isStyleLoaded()) initialize();
    else map.on("load", initialize);
    map.on("moveend", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      runtime.stop();
      map.off("load", initialize);
      map.off("moveend", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      for (const id of POWER_LAYERS) if (mapRef.current === map && map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    };
  }, [showPowerLines, initialPoint.latitude, initialPoint.longitude, mapTilerKey]);

  const selectBaseMap = (selected: LaunchPointBaseMap) => {
    if (selected === "satellite" && !mapTilerKey) return;
    baseMapRef.current = selected;
    const map = mapRef.current;
    if (selected === "satellite") {
      satelliteErrorsRef.current = [];
      setSatelliteError(null);
      if (satelliteError) {
        const source = map?.getSource(LAUNCH_SATELLITE_SOURCE) as maplibregl.RasterTileSource | undefined;
        const specification = launchSatelliteSource(mapTilerKey);
        // setTiles reloads the existing raster source, including previously failed tiles.
        if (source && specification?.tiles) source.setTiles(specification.tiles);
      }
    }
    if (map?.getLayer("plan-base") && map.getLayer(LAUNCH_SATELLITE_LAYER)) setLaunchPointBaseMap(map, selected);
    setBaseMap(selected);
  };

  return (
    <div className={`fixed inset-0 ${allowBaseMapSelection ? "z-[110]" : "z-[90]"} flex flex-col bg-[var(--bc-color-canvas)]`}>
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

      <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: "var(--bc-border)" }}>
        <fieldset className="flex min-w-0 items-center justify-center gap-1 sm:gap-2">
          <legend className="sr-only">Fond de carte du terrain favori</legend>
          {allowBaseMapSelection && (["plan", "satellite"] as const).map((value) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-2 text-xs sm:px-4 sm:text-sm ${value === "satellite" && !mapTilerKey ? "opacity-50" : ""}`} style={{ borderColor: baseMap === value ? "var(--bc-accent)" : "var(--bc-border)" }}>
            <input type="radio" name="favorite-launch-base-map" value={value} checked={baseMap === value} disabled={value === "satellite" && !mapTilerKey} onChange={() => selectBaseMap(value)} className="h-4 w-4 accent-[var(--bc-accent)]" />
            {value === "plan" ? "Plan" : "Satellite"}
          </label>)}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border px-2 text-xs sm:px-4 sm:text-sm" style={{ borderColor: showPowerLines ? "var(--bc-accent)" : "var(--bc-border)" }}>
            <input type="checkbox" checked={showPowerLines} onChange={event => setShowPowerLines(event.target.checked)} className="h-4 w-4 accent-[var(--bc-accent)]" />
            Lignes électriques
          </label>
        </fieldset>
        {allowBaseMapSelection && (!mapTilerKey || satelliteError) && <p role="status" className="mt-1 text-center text-xs" style={{ color: "var(--bc-color-text-muted)" }}>{satelliteError ?? "Fond satellite non configuré."}</p>}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        {showPowerLines && powerState && <p role="status" className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 rounded bg-slate-950/85 px-2 py-1 text-[10px] text-white">{preparationPowerLineStatusLabel(powerState)}</p>}
        {baseMap === "satellite" && <a href="https://www.maptiler.com/" target="_blank" rel="noreferrer" className="absolute bottom-8 left-2 z-10 rounded bg-white/90 p-1" aria-label="MapTiler"><Image unoptimized src="https://api.maptiler.com/resources/logo.svg" alt="MapTiler" width={88} height={22} /></a>}
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
