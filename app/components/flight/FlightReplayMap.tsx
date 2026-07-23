"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RecordedFlight } from "../../lib/recordedFlight";

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
        id: "recorded-flight-line",
        type: "line",
        source: "recorded-flight",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#f59e42",
          "line-width": 4,
          "line-opacity": 0.95,
        },
      });
      new maplibregl.Marker({ color: "#22c55e" })
        .setLngLat(coordinates[0])
        .addTo(map);
      if (coordinates.length > 1) {
        new maplibregl.Marker({ color: "#ef6464" })
          .setLngLat(coordinates.at(-1)!)
          .addTo(map);
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
