"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { JournalFlight } from "../../lib/journalMockData";
import { TWO_DIMENSIONAL_MAP_OPTIONS } from "../../lib/mapInteraction";
import { useRecordedFlightJournalPointsState } from "../../hooks/useRecordedFlightJournalPoints";

type JournalFlightMapProps = {
  flight: JournalFlight;
};

const SOURCE_ID = "journal-flight-track";

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
