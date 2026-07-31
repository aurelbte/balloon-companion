"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { JournalFlight } from "../../lib/journalMockData";
import { TWO_DIMENSIONAL_MAP_OPTIONS } from "../../lib/mapInteraction";

type JournalFlightMapProps = {
  flight: JournalFlight;
};

const SOURCE_ID = "journal-flight-track";

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

export default function JournalFlightMap({ flight }: JournalFlightMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || flight.points.length === 0) {
      return;
    }
    const first = flight.points[0];
    if (!first) return;
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
      center: [first.longitude, first.latitude],
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
      map.addSource(SOURCE_ID, { type: "geojson", data: flightGeoJson(flight) });
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
      map.fitBounds(flightBounds(flight), {
        padding: 38,
        maxZoom: 13,
        duration: 0,
      });
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [flight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const frame = window.requestAnimationFrame(() => {
      map.resize();
      if (expanded) {
        map.fitBounds(flightBounds(flight), {
          padding: 64,
          maxZoom: 13,
          duration: 250,
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, flight]);

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
          : "relative h-[clamp(210px,30dvh,300px)] overflow-hidden rounded-[24px] border border-[var(--bc-border)] [&_.maplibregl-ctrl-top-left]:hidden"
      }
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded || undefined}
      aria-label={expanded ? `Trace du vol ${flight.departure} vers ${flight.arrival}` : undefined}
    >
      <div ref={containerRef} className="h-full w-full" />
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
