"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RecordedFlight } from "../../lib/recordedFlight";
import {
  CARTOGRAPHY_MARKER_STYLE,
  CARTOGRAPHY_PALETTE,
  FLIGHT_TRACK_CARTOGRAPHY_STYLE,
} from "../../lib/cartographyStyle";

export default function FlightReplayMap({ flight }: { flight: RecordedFlight }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || flight.points.length === 0) {
      return;
    }
    const coordinates = flight.points.map(
      (point) => [point.longitude, point.latitude] as [number, number],
    );
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
              '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: coordinates[0],
      zoom: 14,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("recorded-flight", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            },
          ],
        },
      });
      map.addLayer({
        id: "recorded-flight-halo",
        type: "line",
        source: "recorded-flight",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": FLIGHT_TRACK_CARTOGRAPHY_STYLE.haloColor,
          "line-width": FLIGHT_TRACK_CARTOGRAPHY_STYLE.haloWidth,
          "line-opacity": FLIGHT_TRACK_CARTOGRAPHY_STYLE.haloOpacity,
        },
      });
      map.addLayer({
        id: "recorded-flight-line",
        type: "line",
        source: "recorded-flight",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": FLIGHT_TRACK_CARTOGRAPHY_STYLE.lineColor,
          "line-width": FLIGHT_TRACK_CARTOGRAPHY_STYLE.lineWidth,
          "line-opacity": FLIGHT_TRACK_CARTOGRAPHY_STYLE.lineOpacity,
        },
      });
      map.addSource("recorded-flight-endpoints", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { kind: "launch" },
              geometry: { type: "Point", coordinates: coordinates[0] },
            },
            ...(coordinates.length > 1
              ? [
                  {
                    type: "Feature" as const,
                    properties: { kind: "recovery" },
                    geometry: {
                      type: "Point" as const,
                      coordinates: coordinates.at(-1)!,
                    },
                  },
                ]
              : []),
          ],
        },
      });
      map.addLayer({
        id: "recorded-flight-endpoints-halo",
        type: "circle",
        source: "recorded-flight-endpoints",
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.arrivalRadius,
          "circle-color": CARTOGRAPHY_PALETTE.ink,
          "circle-stroke-color": CARTOGRAPHY_PALETTE.cloud,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.outerHaloWidth,
          "circle-opacity": 0.8,
        },
      });
      map.addLayer({
        id: "recorded-flight-endpoints",
        type: "circle",
        source: "recorded-flight-endpoints",
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.arrivalRadius,
          "circle-color": [
            "match",
            ["get", "kind"],
            "launch",
            CARTOGRAPHY_PALETTE.launch,
            CARTOGRAPHY_PALETTE.recovery,
          ],
          "circle-stroke-color": CARTOGRAPHY_PALETTE.ink,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.haloStrokeWidth,
        },
      });
      if (coordinates.length > 1) {
        const bounds = coordinates.reduce(
          (value, coordinate) => value.extend(coordinate),
          new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
        );
        map.fitBounds(bounds, { padding: 42, maxZoom: 15, duration: 0 });
      }
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [flight]);

  if (flight.points.length === 0) {
    return (
      <div
        style={{
          display: "grid",
          minHeight: "220px",
          placeItems: "center",
          border: "1px solid var(--bc-border)",
          borderRadius: "16px",
          color: "var(--bc-text-secondary)",
        }}
      >
        Trace indisponible
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "380px",
        overflow: "hidden",
        border: "1px solid var(--bc-border)",
        borderRadius: "16px",
      }}
      aria-label="Trace du vol enregistré"
    />
  );
}
