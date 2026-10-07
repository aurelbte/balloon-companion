"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { JournalFlight } from "../../lib/journalMockData";
import { TWO_DIMENSIONAL_MAP_OPTIONS } from "../../lib/mapInteraction";
import { useRecordedFlightJournalPointsState } from "../../hooks/useRecordedFlightJournalPoints";

import { useAirspaceCoverage, type AirspaceCoverageViewport } from "../../hooks/useAirspaceCoverage";
import { AIRSPACE_RENDER_ORDER, getAirspaceCategoryStyle, prepareAirspacesForMap } from "../../lib/airspaceMapStyle";
import { PowerLineRuntime, powerLineStatusLabel, type PowerLineState } from "../../lib/powerLinesRuntime";

type JournalFlightMapProps = {
  flight: JournalFlight;
};

const SOURCE_ID = "journal-flight-track";
const AIRSPACE_SOURCE = "journal-airspaces";
const POWER_SOURCE = "journal-power-lines";
const POWER_LAYERS = ["journal-power-casing", "journal-power-line"] as const;
const EMPTY_DATA: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const airspaceLayerId = (category: string, kind: string) => `journal-airspace-${category}-${kind}`;

function compactMapPadding(container: HTMLDivElement): number {
  return Math.max(18, Math.min(32, Math.round(container.clientHeight * 0.14)));
}

function flightBounds(flight: JournalFlight): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  flight.points.forEach((point) =>
    bounds.extend([point.longitude, point.latitude]),
  );
  return bounds;
}

function flightGeoJson(flight: JournalFlight): GeoJSON.FeatureCollection {
  const first = flight.points[0];
  const last = flight.points.at(-1);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "track" },
        geometry: {
          type: "LineString",
          coordinates: flight.points.map((point) => [
            point.longitude,
            point.latitude,
          ]),
        },
      },
      ...(first
        ? [{
            type: "Feature" as const,
            properties: { kind: "departure" },
            geometry: {
              type: "Point" as const,
              coordinates: [first.longitude, first.latitude],
            },
          }]
        : []),
      ...(last
        ? [{
            type: "Feature" as const,
            properties: { kind: "arrival" },
            geometry: {
              type: "Point" as const,
              coordinates: [last.longitude, last.latitude],
            },
          }]
        : []),
    ],
  };
}

function JournalFlightMap({ flight }: JournalFlightMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { points, trackState } = useRecordedFlightJournalPointsState(flight, true);
  const traceRef = useRef<JournalFlight | null>(null);
  const [hasTrace, setHasTrace] = useState(false);

  const [satellite, setSatellite] = useState(false);
  const [showAirspaces, setShowAirspaces] = useState(false);
  const [showPowerLines, setShowPowerLines] = useState(false);
  const [viewport, setViewport] = useState<AirspaceCoverageViewport | null>(null);
  const [powerState, setPowerState] = useState<PowerLineState | null>(null);
  const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "";
  const coverage = useAirspaceCoverage({
    position: null,
    isPositionStale: true,
    viewport,
    explorationEnabled: expanded && showAirspaces && viewport !== null,
  });

  useEffect(() => {
    // An intermediate empty hydration result must not erase an already visible track.
    if (!points.length) return;
    const hydratedFlight = { ...flight, points };
    const unchanged = JSON.stringify(traceRef.current?.points) === JSON.stringify(points);
    traceRef.current = hydratedFlight;
    const map = mapRef.current;
    const source = map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source && !unchanged) {
      source.setData(flightGeoJson(hydratedFlight));
      map!.fitBounds(flightBounds(hydratedFlight), {
        padding: compactMapPadding(containerRef.current!), maxZoom: 13, duration: 0,
      });
    }
    if (source) {
      const frame = window.requestAnimationFrame(() => setHasTrace(true));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [flight, points]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const first = traceRef.current?.points[0];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>',
          },
        },
        layers: [{ id: "journal-plan", type: "raster", source: "osm" }],
      },
      center: first ? [first.longitude, first.latitude] : [0, 0],
      zoom: 10,
      ...TWO_DIMENSIONAL_MAP_OPTIONS,
      attributionControl: { compact: true },
      interactive: true,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: false,
      }),
      "top-left",
    );
    map.on("load", () => {
      if (mapTilerKey) {
        map.addSource("journal-satellite", {
          type: "raster",
          tiles: [`https://api.maptiler.com/maps/hybrid-v4/256/{z}/{x}/{y}@2x.jpg?key=${encodeURIComponent(mapTilerKey)}`],
          tileSize: 256,
          maxzoom: 22,
          attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>',
        });
        map.addLayer({ id: "journal-satellite", type: "raster", source: "journal-satellite", layout: { visibility: "none" } });
      }
      map.addSource(AIRSPACE_SOURCE, { type: "geojson", data: EMPTY_DATA, attribution: '<a href="https://www.openaip.net/" target="_blank">© openAIP</a> — CC BY-NC 4.0' });
      for (const category of AIRSPACE_RENDER_ORDER) {
        const style = getAirspaceCategoryStyle(category);
        const common = {
          source: AIRSPACE_SOURCE,
          filter: ["==", ["get", "visualCategory"], category] as maplibregl.FilterSpecification,
          minzoom: style.minZoom,
          ...(style.maxZoom === undefined ? {} : { maxzoom: style.maxZoom }),
          layout: { visibility: "none" as const },
        };
        map.addLayer({ ...common, id: airspaceLayerId(category, "fill"), type: "fill", paint: { "fill-color": style.color, "fill-opacity": style.fillOpacity } });
        map.addLayer({ ...common, id: airspaceLayerId(category, "outline"), type: "line", paint: { "line-color": style.color, "line-width": style.lineWidth, "line-opacity": style.lineOpacity } });
      }
      map.addSource(POWER_SOURCE, { type: "geojson", data: EMPTY_DATA, attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>' });
      POWER_LAYERS.forEach((id, index) => map.addLayer({
        id, type: "line", source: POWER_SOURCE, minzoom: 8,
        filter: ["==", ["get", "power"], "line"],
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: {
          "line-color": index === 0 ? "rgba(7, 17, 31, 0.82)" : "#dc2626",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, index === 0 ? 4.6 : 2.8, 14, index === 0 ? 7 : 4.6],
        },
      }));
      const hydratedFlight = traceRef.current;
      map.addSource(SOURCE_ID, { type: "geojson", data: hydratedFlight ? flightGeoJson(hydratedFlight) : { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "journal-track-halo",
        type: "line",
        source: SOURCE_ID,
        filter: ["==", ["get", "kind"], "track"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#07111f", "line-width": 8, "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "journal-track",
        type: "line",
        source: SOURCE_ID,
        filter: ["==", ["get", "kind"], "track"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#78afe0", "line-width": 4 },
      });
      map.addLayer({
        id: "journal-points",
        type: "circle",
        source: SOURCE_ID,
        filter: ["!=", ["get", "kind"], "track"],
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "case",
            ["==", ["get", "kind"], "departure"],
            "#55b889",
            "#f3f7fb",
          ],
          "circle-stroke-color": "#07111f",
          "circle-stroke-width": 2,
        },
      });
      if (hydratedFlight) setHasTrace(true);
      if (hydratedFlight) map.fitBounds(flightBounds(hydratedFlight), {
        padding: compactMapPadding(containerRef.current!),
        maxZoom: 13,
        duration: 0,
      });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !expanded) return;
    const updateViewport = () => {
      const center = map.getCenter(), bounds = map.getBounds();
      setViewport({ latitude: center.lat, longitude: center.lng, bounds: {
        west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth(),
      } });
    };
    map.on("moveend", updateViewport);
    if (map.getSource(SOURCE_ID)) updateViewport();
    else map.once("load", updateViewport);
    return () => { map.off("moveend", updateViewport); map.off("load", updateViewport); };
  }, [expanded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      const useSatellite = expanded && satellite && Boolean(map.getLayer("journal-satellite"));
      map.setLayoutProperty("journal-plan", "visibility", useSatellite ? "none" : "visible");
      if (map.getLayer("journal-satellite")) map.setLayoutProperty("journal-satellite", "visibility", useSatellite ? "visible" : "none");
      for (const category of AIRSPACE_RENDER_ORDER) {
        for (const kind of ["fill", "outline"]) map.setLayoutProperty(airspaceLayerId(category, kind), "visibility", expanded && showAirspaces ? "visible" : "none");
      }
      for (const id of POWER_LAYERS) map.setLayoutProperty(id, "visibility", expanded && showPowerLines ? "visible" : "none");
    };
    // The track source is created after all optional sources/layers, on initial load.
    if (map.getSource(SOURCE_ID)) sync();
    else map.once("load", sync);
    return () => { map.off("load", sync); };
  }, [expanded, satellite, showAirspaces, showPowerLines]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => (map.getSource(AIRSPACE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(
      prepareAirspacesForMap(coverage.airspaces, { currentAltitudeMeters: null }),
    );
    if (map.getSource(AIRSPACE_SOURCE)) sync();
    else map.once("load", sync);
    return () => { map.off("load", sync); };
  }, [coverage.airspaces]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !expanded || !showPowerLines) return;
    const runtime = new PowerLineRuntime((state) => {
      setPowerState(state);
      (map.getSource(POWER_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(state.data);
    });
    const refresh = () => {
      if (!map.getSource(POWER_SOURCE)) return;
      const bounds = map.getBounds();
      void runtime.update({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, navigator.onLine);
    };
    if (map.getSource(POWER_SOURCE)) refresh();
    else map.once("load", refresh);
    map.on("moveend", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      runtime.stop();
      map.off("load", refresh);
      map.off("moveend", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, [expanded, showPowerLines]);

  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map || expanded || typeof ResizeObserver === "undefined") return;
    let width = container.clientWidth;
    let height = container.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width === container.clientWidth && height === container.clientHeight) return;
      width = container.clientWidth;
      height = container.clientHeight;
      map.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [expanded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const frame = window.requestAnimationFrame(() => {
      map.resize();
      if (traceRef.current) {
        map.fitBounds(flightBounds(traceRef.current), {
          padding: expanded ? 64 : compactMapPadding(containerRef.current!),
          maxZoom: 13,
          duration: 250,
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  return (
    <div
      className={
        expanded
          ? "fixed inset-0 z-[80] bg-[var(--bc-background)]"
          : "relative h-[clamp(128px,23dvh,220px)] overflow-hidden rounded-[20px] border border-[var(--bc-border)] [&_.maplibregl-ctrl-top-left]:hidden"
      }
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? `Trace du vol ${flight.departure} vers ${flight.arrival}` : undefined}
    >
      <div ref={containerRef} className={`h-full w-full ${hasTrace ? "" : "invisible"}`} />
      {!hasTrace && points.length === 0 && <p className="absolute inset-0 flex items-center justify-center px-5 text-center text-sm text-[var(--bc-text-secondary)]">{trackState === "LOADING_CLOUD" ? "Chargement de la trace…" : trackState === "CLOUD_OFFLINE" ? "Trace disponible dans le Cloud — connexion requise" : flight.origin === "REAL_GPS" ? "La trace s’affichera ici lorsqu’elle sera disponible." : "Trace indisponible"}</p>}
      {expanded && (
        <div className="absolute inset-x-3 bottom-[max(36px,env(safe-area-inset-bottom))] z-10 mx-auto max-w-md rounded-2xl border border-white/20 bg-[var(--bc-color-surface-glass)] p-2 text-white shadow-lg">
          <div role="group" aria-label="Couches de la carte" className="flex flex-wrap justify-center gap-1">
            {[
              { label: "Satellite", active: satellite, toggle: () => setSatellite((value) => !value), disabled: !mapTilerKey },
              { label: "Espaces aériens", active: showAirspaces, toggle: () => setShowAirspaces((value) => !value), disabled: false },
              { label: "Lignes électriques", active: showPowerLines, toggle: () => setShowPowerLines((value) => !value), disabled: false },
            ].map(({ label, active, toggle, disabled }) => (
              <button key={label} type="button" aria-pressed={active} disabled={disabled} onClick={toggle}
                title={disabled ? "Satellite indisponible : fond non configuré" : undefined}
                className={`min-h-11 rounded-xl border px-2 text-xs font-semibold disabled:opacity-40 ${active ? "border-sky-300 bg-sky-700" : "border-white/20 bg-black/30"}`}>
                {label}
              </button>
            ))}
          </div>
          {showAirspaces && coverage.statusMessage && <p role="status" className="px-1 pt-1 text-xs">{coverage.statusMessage}</p>}
          {showPowerLines && powerState && powerLineStatusLabel(powerState) && <p role="status" className="px-1 pt-1 text-xs">{powerLineStatusLabel(powerState)}</p>}
        </div>
      )}
      {expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="absolute right-3 top-3 z-10 flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/20 bg-[var(--bc-color-surface-glass)] text-white shadow-[var(--bc-shadow-xs)]"
          aria-label="Fermer la carte plein écran"
        >
          <X size={20} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute inset-0 z-10 flex items-start justify-end p-3 text-white"
          aria-label="Ouvrir la carte plein écran"
        >
          <span className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/20 bg-[var(--bc-color-surface-glass)] shadow-[var(--bc-shadow-xs)]">
            <Maximize2 size={19} />
          </span>
        </button>
      )}
    </div>
  );
}

// Journal state may rebuild equivalent flight objects during hydration.
export default memo(JournalFlightMap, (previous, next) =>
  previous.flight.id === next.flight.id &&
  previous.flight.origin === next.flight.origin &&
  previous.flight.departure === next.flight.departure &&
  previous.flight.arrival === next.flight.arrival &&
  (previous.flight as JournalFlight & { sourceFlightId?: string }).sourceFlightId ===
    (next.flight as JournalFlight & { sourceFlightId?: string }).sourceFlightId &&
  JSON.stringify(previous.flight.points) === JSON.stringify(next.flight.points),
);
