"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { LayerSpecification, SourceSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createAirspaceSelectionIndex,
  getRenderedAirspaceId,
  resolveRenderedAirspaces,
  type AirspaceSelectionIndex,
  type RenderedAirspaceFeature,
} from "../../lib/airspaceSelection";
import type {
  AirspaceFeatureCollection,
  AirspaceGeoJsonProperties,
} from "../../lib/openaip";
import {
  AIRSPACE_MAP_PALETTE,
  AIRSPACE_RENDER_ORDER,
  getAirspaceCategoryStyle,
  getAirspaceVisualCategory,
  isAirspaceCategoryVisibleAtZoom,
  prepareAirspacesForMap,
  type AirspaceVisualCategory,
} from "../../lib/airspaceMapStyle";
import { sortAirspacesForMapClick } from "../../lib/airspaceMapSelection";
import type { BaseMap, GeoPoint, ProjectionPoint } from "../../types/flight";

const SATELLITE_SOURCE_ID = "maptiler-satellite-source";
const SATELLITE_LAYER_ID = "maptiler-satellite-layer";
const PLAN_LAYER_ID = "osm-tiles";
const AIRSPACES_SOURCE_ID = "airspaces-source";
const AIRSPACES_SELECTED_FILL_LAYER_ID = "airspaces-selected-fill";
const AIRSPACES_SELECTED_OUTLINE_LAYER_ID = "airspaces-selected-outline";
const NO_SELECTED_AIRSPACE_ID = "__no_selected_airspace__";
const SATELLITE_FAILURE_MESSAGE = "Satellite indisponible — fond Plan restauré";
const SATELLITE_ERROR_WINDOW_MS = 10_000;
const SATELLITE_LOAD_TIMEOUT_MS = 12_000;
const MAX_SATELLITE_ERRORS = 3;

function getAirspaceLayerId(
  category: AirspaceVisualCategory,
  kind: "fill" | "outline",
): string {
  return `airspaces-${category.toLowerCase().replaceAll("_", "-")}-${kind}`;
}

const AIRSPACE_BASE_LAYER_IDS = AIRSPACE_RENDER_ORDER.flatMap((category) => [
  getAirspaceLayerId(category, "fill"),
  getAirspaceLayerId(category, "outline"),
]);

interface FlightMapProps {
  currentPosition: GeoPoint | null;
  baseMap: BaseMap;
  flightPoints: GeoPoint[];
  gpsProjection: ProjectionPoint[];
  weatherProjection: ProjectionPoint[];
  airspaces: AirspaceFeatureCollection;
  showAirspaces: boolean;
  selectedAirspaceId: string | null;
  showGpsProjection: boolean;
  showWeatherProjection: boolean;
  onSatelliteError: (message: string) => void;
  onAirspacesSelected?: (airspaces: AirspaceGeoJsonProperties[]) => void;
  onViewportChange?: (viewport: FlightMapViewport) => void;
  onMapReady?: (map: maplibregl.Map) => void;
}

interface FlightMapViewport {
  latitude: number;
  longitude: number;
  zoom: number;
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
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
  baseMap,
  flightPoints,
  gpsProjection,
  weatherProjection,
  airspaces,
  showAirspaces,
  selectedAirspaceId,
  showGpsProjection,
  showWeatherProjection,
  onSatelliteError,
  onAirspacesSelected,
  onViewportChange,
  onMapReady,
}: FlightMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const sourceRef = useRef<boolean>(false);
  const onMapReadyRef = useRef(onMapReady);
  const onAirspacesSelectedRef = useRef(onAirspacesSelected);
  const onViewportChangeRef = useRef(onViewportChange);
  const flightPointsRef = useRef(flightPoints);
  const styleAltitude =
    currentPosition?.altitude !== null &&
    currentPosition?.altitude !== undefined &&
    Number.isFinite(currentPosition.altitude)
      ? Math.round(currentPosition.altitude / 50) * 50
      : null;
  const styleVerticalAccuracy =
    currentPosition?.verticalAccuracy !== null &&
    currentPosition?.verticalAccuracy !== undefined &&
    Number.isFinite(currentPosition.verticalAccuracy)
      ? Math.round(currentPosition.verticalAccuracy / 10) * 10
      : null;
  const styledAirspaces = useMemo(
    () =>
      prepareAirspacesForMap(airspaces, {
        currentAltitudeMeters: styleAltitude,
        verticalAccuracyMeters: styleVerticalAccuracy,
      }),
    [airspaces, styleAltitude, styleVerticalAccuracy],
  );
  const initialAirspacesRef = useRef(styledAirspaces);
  const airspaceIndexRef = useRef<AirspaceSelectionIndex>(
    createAirspaceSelectionIndex(airspaces)
  );
  const airspaceFeaturesByIdRef = useRef(
    new Map(
      airspaces.features.map((feature) => [
        feature.properties.airspaceId,
        feature,
      ]),
    ),
  );
  const selectedAirspaceIdRef = useRef(selectedAirspaceId);
  const showAirspacesRef = useRef(showAirspaces);
  const baseMapRef = useRef(baseMap);
  const onSatelliteErrorRef = useRef(onSatelliteError);
  const satelliteErrorsRef = useRef<number[]>([]);
  const satelliteFailedRef = useRef(false);
  const satelliteLoadTimeoutRef = useRef<number | null>(null);
  const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;

useEffect(() => {
  onMapReadyRef.current = onMapReady;
}, [onMapReady]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    onAirspacesSelectedRef.current = onAirspacesSelected;
  }, [onAirspacesSelected]);

  useEffect(() => {
    flightPointsRef.current = flightPoints;
  }, [flightPoints]);

  useEffect(() => {
    airspaceIndexRef.current = createAirspaceSelectionIndex(airspaces);
    airspaceFeaturesByIdRef.current = new Map(
      airspaces.features.map((feature) => [
        feature.properties.airspaceId,
        feature,
      ]),
    );
  }, [airspaces]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    const classifications = new Map<string, {
      type: number;
      name: string;
      visualCategory: AirspaceVisualCategory;
    }>();
    for (const feature of airspaces.features) {
      const properties = feature.properties;
      const key = `${properties.type}:${properties.name}`;
      if (!classifications.has(key)) {
        classifications.set(key, {
          type: properties.type,
          name: properties.name,
          visualCategory: getAirspaceVisualCategory(properties),
        });
      }
    }
    if (classifications.size > 0) {
      console.debug(
        "[Airspaces] Catégorisation OpenAIP",
        [...classifications.values()],
      );
    }
  }, [airspaces]);

  useEffect(() => {
    selectedAirspaceIdRef.current = selectedAirspaceId;
  }, [selectedAirspaceId]);

  useEffect(() => {
    showAirspacesRef.current = showAirspaces;
  }, [showAirspaces]);

  useEffect(() => {
    baseMapRef.current = baseMap;
  }, [baseMap]);

  useEffect(() => {
    onSatelliteErrorRef.current = onSatelliteError;
  }, [onSatelliteError]);

  // Initialiser la carte
  useEffect(() => {
    if (map.current || !mapContainer.current) {
      return;
    }

    const baseSources: Record<string, SourceSpecification> = {
      "osm-tiles": {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
      },
    };
    const baseLayers: LayerSpecification[] = [
      {
        id: PLAN_LAYER_ID,
        type: "raster",
        source: "osm-tiles",
        minzoom: 0,
        maxzoom: 19,
      },
    ];

    if (mapTilerKey) {
      baseSources[SATELLITE_SOURCE_ID] = {
        type: "raster" as const,
        tiles: [
          `https://api.maptiler.com/maps/hybrid-v4/256/{z}/{x}/{y}@2x.jpg?key=${encodeURIComponent(mapTilerKey)}`,
        ],
        tileSize: 256,
        maxzoom: 22,
        attribution:
          '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
      };
      baseLayers.push({
        id: SATELLITE_LAYER_ID,
        type: "raster",
        source: SATELLITE_SOURCE_ID,
        minzoom: 0,
        maxzoom: 22,
        layout: { visibility: "none" },
      });
    }

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
  version: 8,
  sources: baseSources,
  layers: baseLayers,
},
      center: [3.058, 50.631],
      zoom: 12,
      pitch: 0,
      bearing: 0,
      attributionControl: {
        compact: true,
      },
    });

    // Ajouter les contrôles de navigation
    map.current.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
      }),
      "bottom-right"
    );

    const notifyViewportChange = () => {
      if (!map.current) return;

      const center = map.current.getCenter();
      const bounds = map.current.getBounds();
      onViewportChangeRef.current?.({
        latitude: center.lat,
        longitude: center.lng,
        zoom: map.current.getZoom(),
        bounds: {
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        },
      });
    };

    map.current.on("moveend", notifyViewportChange);

    map.current.on("click", (event) => {
      if (
        !map.current ||
        !showAirspacesRef.current ||
        !AIRSPACE_BASE_LAYER_IDS.some((layerId) =>
          Boolean(map.current?.getLayer(layerId)),
        )
      ) {
        return;
      }

      const hitBox: [[number, number], [number, number]] = [
        [event.point.x - 8, event.point.y - 8],
        [event.point.x + 8, event.point.y + 8],
      ];
      const zoom = map.current.getZoom();
      const visibleCategories = AIRSPACE_RENDER_ORDER.filter((category) =>
        isAirspaceCategoryVisibleAtZoom(category, zoom),
      );
      const visibleFillLayerIds = visibleCategories
        .map((category) => getAirspaceLayerId(category, "fill"))
        .filter((layerId) => Boolean(map.current?.getLayer(layerId)));
      const visibleOutlineLayerIds = visibleCategories
        .map((category) => getAirspaceLayerId(category, "outline"))
        .filter((layerId) => Boolean(map.current?.getLayer(layerId)));
      const renderedFeatures = map.current.queryRenderedFeatures(hitBox, {
        layers: [...visibleFillLayerIds, ...visibleOutlineLayerIds],
      });

      const resolvedAirspaces = resolveRenderedAirspaces(
        renderedFeatures as RenderedAirspaceFeature[],
        airspaceIndexRef.current
      );
      const selectedAirspaces = sortAirspacesForMapClick({
        candidates: resolvedAirspaces.flatMap((airspace) => {
          const feature = airspaceFeaturesByIdRef.current.get(
            airspace.airspaceId,
          );
          return feature
            ? [{ airspace, geometry: feature.geometry }]
            : [];
        }),
        zoom,
      }).map(({ airspace }) => airspace);

      if (
        process.env.NODE_ENV === "development" &&
        renderedFeatures.length > 0 &&
        resolvedAirspaces.length === 0
      ) {
        console.warn("[Airspaces] Rendered features found but unresolved", {
          renderedFeatures,
          renderedIds: renderedFeatures.map((feature) =>
            getRenderedAirspaceId(feature as RenderedAirspaceFeature)
          ),
          availableIds: [...airspaceIndexRef.current.byId.keys()],
        });
      }

      onAirspacesSelectedRef.current?.(selectedAirspaces);
    });

    // Ajouter une source pour les projections
    map.current.on("load", () => {
      if (!map.current) return;

      if (!map.current.getSource(AIRSPACES_SOURCE_ID)) {
        map.current.addSource(AIRSPACES_SOURCE_ID, {
          type: "geojson",
          data: initialAirspacesRef.current,
          attribution:
            '<a href="https://www.openaip.net/" target="_blank">© openAIP</a> — <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank">CC BY-NC 4.0</a>',
        });
      }

      for (const category of AIRSPACE_RENDER_ORDER) {
        const categoryStyle = getAirspaceCategoryStyle(category);
        const categoryFilter: maplibregl.FilterSpecification = [
          "==",
          ["get", "visualCategory"],
          category,
        ];
        const fillLayerId = getAirspaceLayerId(category, "fill");
        const outlineLayerId = getAirspaceLayerId(category, "outline");

        if (!map.current.getLayer(fillLayerId)) {
          map.current.addLayer({
            id: fillLayerId,
            type: "fill",
            source: AIRSPACES_SOURCE_ID,
            filter: categoryFilter,
            minzoom: categoryStyle.minZoom,
            ...(categoryStyle.maxZoom === undefined
              ? {}
              : { maxzoom: categoryStyle.maxZoom }),
            layout: {
              visibility: showAirspacesRef.current ? "visible" : "none",
            },
            paint: {
              "fill-color": categoryStyle.color,
              "fill-opacity": [
                "case",
                ["==", ["get", "verticalRelevance"], "ABOVE_FAR"],
                0,
                categoryStyle.fillOpacity,
              ],
            },
          });
        }

        if (!map.current.getLayer(outlineLayerId)) {
          map.current.addLayer({
            id: outlineLayerId,
            type: "line",
            source: AIRSPACES_SOURCE_ID,
            filter: categoryFilter,
            minzoom: categoryStyle.minZoom,
            ...(categoryStyle.maxZoom === undefined
              ? {}
              : { maxzoom: categoryStyle.maxZoom }),
            layout: {
              "line-join": "round",
              "line-cap": "round",
              visibility: showAirspacesRef.current ? "visible" : "none",
            },
            paint: {
              "line-color": categoryStyle.color,
              "line-width": [
                "case",
                ["==", ["get", "verticalRelevance"], "ABOVE_FAR"],
                Math.max(0.7, categoryStyle.lineWidth * 0.75),
                categoryStyle.lineWidth,
              ],
              "line-opacity": [
                "case",
                ["==", ["get", "verticalRelevance"], "ABOVE_FAR"],
                Math.min(categoryStyle.lineOpacity, 0.42),
                categoryStyle.lineOpacity,
              ],
            },
          });
        }
      }

      if (!map.current.getLayer(AIRSPACES_SELECTED_FILL_LAYER_ID)) {
        map.current.addLayer({
          id: AIRSPACES_SELECTED_FILL_LAYER_ID,
          type: "fill",
          source: AIRSPACES_SOURCE_ID,
          filter: [
            "==",
            ["get", "airspaceId"],
            selectedAirspaceIdRef.current ?? NO_SELECTED_AIRSPACE_ID,
          ],
          layout: {
            visibility: showAirspacesRef.current ? "visible" : "none",
          },
          paint: {
            "fill-color": AIRSPACE_MAP_PALETTE.SELECTED,
            "fill-opacity": 0.2,
          },
        });
      }

      if (!map.current.getLayer(AIRSPACES_SELECTED_OUTLINE_LAYER_ID)) {
        map.current.addLayer({
          id: AIRSPACES_SELECTED_OUTLINE_LAYER_ID,
          type: "line",
          source: AIRSPACES_SOURCE_ID,
          filter: [
            "==",
            ["get", "airspaceId"],
            selectedAirspaceIdRef.current ?? NO_SELECTED_AIRSPACE_ID,
          ],
          layout: {
            visibility: showAirspacesRef.current ? "visible" : "none",
          },
          paint: {
            "line-color": AIRSPACE_MAP_PALETTE.SELECTED,
            "line-width": 3.2,
            "line-opacity": 1,
          },
        });
      }

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
      notifyViewportChange();
    });

    map.current.on("sourcedata", (event) => {
      if (
        event.sourceId === SATELLITE_SOURCE_ID &&
        event.isSourceLoaded
      ) {
        satelliteErrorsRef.current = [];
        if (satelliteLoadTimeoutRef.current !== null) {
          window.clearTimeout(satelliteLoadTimeoutRef.current);
          satelliteLoadTimeoutRef.current = null;
        }
      }
    });

    map.current.on("error", (event) => {
      if (
        baseMapRef.current !== "satellite" ||
        satelliteFailedRef.current ||
        !event.error.message.includes("api.maptiler.com")
      ) {
        return;
      }

      const now = Date.now();
      satelliteErrorsRef.current = satelliteErrorsRef.current
        .filter((timestamp) => now - timestamp <= SATELLITE_ERROR_WINDOW_MS)
        .concat(now);

      if (satelliteErrorsRef.current.length >= MAX_SATELLITE_ERRORS) {
        satelliteFailedRef.current = true;
        onSatelliteErrorRef.current(SATELLITE_FAILURE_MESSAGE);
      }
    });

    // Cleanup au démontage
    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
        markerRef.current = null;
        sourceRef.current = false;
      }
      if (satelliteLoadTimeoutRef.current !== null) {
        window.clearTimeout(satelliteLoadTimeoutRef.current);
      }
    };
  }, [mapTilerKey]);

  useEffect(() => {
    if (!map.current || !sourceRef.current) return;

    const canShowSatellite =
      baseMap === "satellite" &&
      Boolean(mapTilerKey) &&
      !satelliteFailedRef.current &&
      Boolean(map.current.getLayer(SATELLITE_LAYER_ID));

    map.current.setLayoutProperty(
      PLAN_LAYER_ID,
      "visibility",
      canShowSatellite ? "none" : "visible"
    );

    if (map.current.getLayer(SATELLITE_LAYER_ID)) {
      map.current.setLayoutProperty(
        SATELLITE_LAYER_ID,
        "visibility",
        canShowSatellite ? "visible" : "none"
      );
    }

    if (satelliteLoadTimeoutRef.current !== null) {
      window.clearTimeout(satelliteLoadTimeoutRef.current);
      satelliteLoadTimeoutRef.current = null;
    }

    if (canShowSatellite) {
      satelliteErrorsRef.current = [];
      satelliteLoadTimeoutRef.current = window.setTimeout(() => {
        if (
          baseMapRef.current === "satellite" &&
          !satelliteFailedRef.current &&
          map.current &&
          !map.current.isSourceLoaded(SATELLITE_SOURCE_ID)
        ) {
          satelliteFailedRef.current = true;
          onSatelliteErrorRef.current(SATELLITE_FAILURE_MESSAGE);
        }
      }, SATELLITE_LOAD_TIMEOUT_MS);
    }
  }, [baseMap, mapTilerKey]);

  useEffect(() => {
    if (!map.current || !sourceRef.current) return;

    const source = map.current.getSource(AIRSPACES_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(styledAirspaces);

    for (const layerId of [
      ...AIRSPACE_BASE_LAYER_IDS,
      AIRSPACES_SELECTED_FILL_LAYER_ID,
      AIRSPACES_SELECTED_OUTLINE_LAYER_ID,
    ]) {
      if (map.current.getLayer(layerId)) {
        map.current.setLayoutProperty(
          layerId,
          "visibility",
          showAirspaces ? "visible" : "none"
        );
      }
    }
  }, [styledAirspaces, showAirspaces]);

  useEffect(() => {
    if (!map.current || !sourceRef.current) return;

    const filter: maplibregl.FilterSpecification = [
      "==",
      ["get", "airspaceId"],
      selectedAirspaceId ?? NO_SELECTED_AIRSPACE_ID,
    ];

    for (const layerId of [
      AIRSPACES_SELECTED_FILL_LAYER_ID,
      AIRSPACES_SELECTED_OUTLINE_LAYER_ID,
    ]) {
      if (map.current.getLayer(layerId)) {
        map.current.setFilter(layerId, filter);
      }
    }
  }, [selectedAirspaceId]);

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

  return (
    <>
      <style>{`
        .flight-map .maplibregl-ctrl-bottom-left {
          bottom: calc(max(6px, env(safe-area-inset-bottom)) + 124px);
          left: 6px;
        }
        .flight-map .maplibregl-ctrl-attrib {
          max-width: calc(100vw - 170px);
          font-size: 10px;
        }
        @media (max-width: 380px) {
          .flight-map .maplibregl-ctrl-attrib { max-width: 185px; }
        }
      `}</style>
      <div
        ref={mapContainer}
        className="flight-map"
        style={{ width: "100%", height: "100%" }}
      />
      {baseMap === "satellite" && mapTilerKey && (
        <a
          href="https://www.maptiler.com/"
          target="_blank"
          rel="noreferrer"
          aria-label="MapTiler"
          style={{
            position: "absolute",
            left: "8px",
            bottom: "calc(max(6px, env(safe-area-inset-bottom)) + 158px)",
            zIndex: 2,
            display: "block",
            width: "75px",
            height: "25px",
          }}
        >
          {/* Logo MapTiler officiel, obligatoire avec un compte Free. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://api.maptiler.com/resources/logo.svg"
            alt="MapTiler"
            width="75"
            height="25"
            style={{
              display: "block",
              width: "75px",
              height: "25px",
              objectFit: "contain",
            }}
          />
        </a>
      )}
    </>
  );
}
