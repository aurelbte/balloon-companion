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
import {
  CURRENT_POSITION_MARKER_STYLE,
  FLIGHT_TRACK_STYLE,
  GPS_PROJECTION_STYLE,
  getFollowCameraOffset,
  getFollowPositionAfterAction,
  getMapCameraInsets,
  getPositionMarkerHaloOpacity,
  getPositionMarkerRotation,
  getVisibleProjectionMinutes,
  shouldSuspendFollowForDrag,
  shouldApplyInitialCenter,
} from "../../lib/flightMapPresentation";
import type { BaseMap, GeoPoint, ProjectionPoint } from "../../types/flight";
import type { ExportedPlannedTrajectory } from "../../lib/trajectory/weatherAnalysisStorage";
import { MODEL_LINE_STYLES } from "../../lib/trajectory/analysisStyles";
import {
  CARTOGRAPHY_MARKER_STYLE,
  CARTOGRAPHY_PALETTE,
  PLANNED_TRAJECTORY_STYLE,
  WEATHER_PROJECTION_CARTOGRAPHY_STYLE,
} from "../../lib/cartographyStyle";
import {
  REFERENCE_ORIENTATION,
  TWO_DIMENSIONAL_MAP_OPTIONS,
} from "../../lib/mapInteraction";
import {
  getPowerLineQueryBounds,
  powerLineBoundsContain,
  powerLineBoundsKey,
  type PowerLineBounds,
} from "../../lib/powerLines";

const SATELLITE_SOURCE_ID = "maptiler-satellite-source";
const SATELLITE_LAYER_ID = "maptiler-satellite-layer";
const PLAN_LAYER_ID = "osm-tiles";
const AIRSPACES_SOURCE_ID = "airspaces-source";
const AIRSPACES_SELECTED_FILL_LAYER_ID = "airspaces-selected-fill";
const AIRSPACES_SELECTED_OUTLINE_LAYER_ID = "airspaces-selected-outline";
const POWER_LINES_SOURCE_ID = "osm-power-lines-source";
const POWER_LINES_CASING_LAYER_ID = "osm-power-lines-casing-layer";
const POWER_LINES_LAYER_ID = "osm-power-lines-layer";
const PLANNED_TRAJECTORIES_SOURCE_ID = "planned-trajectories-source";
const NO_SELECTED_AIRSPACE_ID = "__no_selected_airspace__";
const SATELLITE_FAILURE_MESSAGE = "Satellite indisponible — fond Plan restauré";
const SATELLITE_ERROR_WINDOW_MS = 10_000;
const SATELLITE_LOAD_TIMEOUT_MS = 12_000;
const MAX_SATELLITE_ERRORS = 3;
const FOLLOW_CAMERA_DURATION_MS = 180;
const powerLinesCache = new Map<string, Promise<GeoJSON.FeatureCollection>>();
const loadedPowerLineBounds: PowerLineBounds[] = [];
const loadedPowerLineFeatures = new Map<string | number, GeoJSON.Feature>();

function loadedPowerLinesGeoJson(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [...loadedPowerLineFeatures.values()] };
}

interface ProjectionTimeMarker {
  minutes: number;
  marker: maplibregl.Marker;
}

function getMapViewportSize(map: maplibregl.Map) {
  const canvas = map.getCanvas();
  return {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  };
}

function followMapPosition(
  map: maplibregl.Map,
  position: GeoPoint,
  duration: number,
) {
  map.easeTo({
    center: [position.longitude, position.latitude],
    offset: getFollowCameraOffset(getMapViewportSize(map)),
    duration,
  });
}

function clearProjectionTimeMarkers(markers: ProjectionTimeMarker[]) {
  for (const { marker } of markers) marker.remove();
  markers.length = 0;
}

function syncProjectionTimeMarkers(
  map: maplibregl.Map,
  markers: ProjectionTimeMarker[],
  projection: readonly ProjectionPoint[],
) {
  const existingByMinutes = new Map(
    markers.map((item) => [item.minutes, item]),
  );
  const nextMarkers: ProjectionTimeMarker[] = [];

  for (const point of projection) {
    let item = existingByMinutes.get(point.minutes);
    if (item) {
      item.marker.setLngLat([point.longitude, point.latitude]);
      existingByMinutes.delete(point.minutes);
    } else {
      const element = document.createElement("div");
      element.className = "flight-projection-time-marker";
      element.textContent = `${point.minutes} min`;
      element.setAttribute(
        "aria-label",
        `Projection à ${point.minutes} minutes`,
      );
      item = {
        minutes: point.minutes,
        marker: new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat([point.longitude, point.latitude])
          .addTo(map),
      };
    }
    nextMarkers.push(item);
  }

  for (const { marker } of existingByMinutes.values()) marker.remove();
  markers.splice(0, markers.length, ...nextMarkers);
}

function updateProjectionTimeMarkerVisibility(
  map: maplibregl.Map,
  markers: ProjectionTimeMarker[],
  projection: readonly ProjectionPoint[],
) {
  const visibleMinutes = new Set(
    getVisibleProjectionMinutes(map.getZoom(), projection),
  );
  const visibleScreenPoints: Array<{ x: number; y: number }> = [];

  for (const { marker, minutes } of [...markers].sort(
    (left, right) => left.minutes - right.minutes,
  )) {
    const screenPoint = map.project(marker.getLngLat());
    const overlaps = visibleScreenPoints.some(
      (point) =>
        Math.abs(point.x - screenPoint.x) < 46 &&
        Math.abs(point.y - screenPoint.y) < 26,
    );
    const visible = visibleMinutes.has(minutes) && !overlaps;
    marker.getElement().style.display = visible ? "block" : "none";
    if (visible) visibleScreenPoints.push(screenPoint);
  }
}

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
  flightPoints: readonly GeoPoint[];
  gpsProjection: readonly ProjectionPoint[];
  weatherProjection: readonly ProjectionPoint[];
  plannedTrajectories: readonly ExportedPlannedTrajectory[];
  airspaces: AirspaceFeatureCollection;
  showAirspaces: boolean;
  showPowerLines: boolean;
  selectedAirspaceId: string | null;
  showGpsProjection: boolean;
  showWeatherProjection: boolean;
  followPosition: boolean;
  recenterRequest: number;
  fitProjectionRequest: number;
  onSatelliteError: (message: string) => void;
  onAirspacesSelected?: (airspaces: AirspaceGeoJsonProperties[]) => void;
  onFollowPositionChange?: (following: boolean) => void;
  onMapPress?: () => void;
  onViewportChange?: (viewport: FlightMapViewport) => void;
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

function buildFlightTrackData(
  points: readonly GeoPoint[],
): GeoJSON.FeatureCollection {
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
  plannedTrajectories,
  airspaces,
  showAirspaces,
  showPowerLines,
  selectedAirspaceId,
  showGpsProjection,
  showWeatherProjection,
  followPosition,
  recenterRequest,
  fitProjectionRequest,
  onSatelliteError,
  onAirspacesSelected,
  onFollowPositionChange,
  onMapPress,
  onViewportChange,
}: FlightMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const lastMarkerHeadingRef = useRef<number | null>(null);
  const projectionTimeMarkersRef = useRef<ProjectionTimeMarker[]>([]);
  const sourceRef = useRef<boolean>(false);
  const onAirspacesSelectedRef = useRef(onAirspacesSelected);
  const onViewportChangeRef = useRef(onViewportChange);
  const onFollowPositionChangeRef = useRef(onFollowPositionChange);
  const onMapPressRef = useRef(onMapPress);
  const flightPointsRef = useRef(flightPoints);
  const plannedTrajectoriesRef = useRef(plannedTrajectories);
  const currentPositionRef = useRef(currentPosition);
  const gpsProjectionRef = useRef(gpsProjection);
  const showGpsProjectionRef = useRef(showGpsProjection);
  const followPositionRef = useRef(followPosition);
  const initialCenterCompletedRef = useRef(false);
  const lastRecenterRequestRef = useRef(recenterRequest);
  const lastFitProjectionRequestRef = useRef(fitProjectionRequest);
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
  const showPowerLinesRef = useRef(showPowerLines);
  const baseMapRef = useRef(baseMap);
  const onSatelliteErrorRef = useRef(onSatelliteError);
  const satelliteErrorsRef = useRef<number[]>([]);
  const satelliteFailedRef = useRef(false);
  const satelliteLoadTimeoutRef = useRef<number | null>(null);
  const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    onFollowPositionChangeRef.current = onFollowPositionChange;
  }, [onFollowPositionChange]);

  useEffect(() => {
    onMapPressRef.current = onMapPress;
  }, [onMapPress]);

  useEffect(() => {
    onAirspacesSelectedRef.current = onAirspacesSelected;
  }, [onAirspacesSelected]);

  useEffect(() => {
    flightPointsRef.current = flightPoints;
  }, [flightPoints]);

  useEffect(() => {
    plannedTrajectoriesRef.current = plannedTrajectories;
  }, [plannedTrajectories]);

  useEffect(() => {
    currentPositionRef.current = currentPosition;
  }, [currentPosition]);

  useEffect(() => {
    gpsProjectionRef.current = gpsProjection;
  }, [gpsProjection]);

  useEffect(() => {
    showGpsProjectionRef.current = showGpsProjection;
  }, [showGpsProjection]);

  useEffect(() => {
    followPositionRef.current = followPosition;
  }, [followPosition]);

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

  const fetchPowerLinesForViewport = async () => {
    if (!showPowerLinesRef.current || !map.current) return;
    const bounds = map.current.getBounds();
    const normalized = getPowerLineQueryBounds({
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    });
    const source = map.current.getSource(POWER_LINES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (loadedPowerLineBounds.some((coverage) => powerLineBoundsContain(coverage, normalized))) {
      source?.setData(loadedPowerLinesGeoJson());
      return;
    }
    const key = powerLineBoundsKey(normalized);
    let request = powerLinesCache.get(key);
    if (!request) {
      const params = new URLSearchParams(Object.entries(normalized).map(([name, value]) => [name, String(value)]));
      request = fetch(`/api/osm/power-lines?${params}`).then((response) => {
        if (!response.ok) throw new Error("Power lines unavailable");
        return response.json() as Promise<GeoJSON.FeatureCollection>;
      });
      powerLinesCache.set(key, request);
      request.catch(() => powerLinesCache.delete(key));
    }
    try {
      const data = await request;
      for (const feature of data.features) {
        if (feature.id !== undefined) loadedPowerLineFeatures.set(feature.id, feature);
      }
      if (!loadedPowerLineBounds.some((coverage) => powerLineBoundsKey(coverage) === key)) loadedPowerLineBounds.push(normalized);
      if (!showPowerLinesRef.current || !map.current) return;
      (map.current.getSource(POWER_LINES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(loadedPowerLinesGeoJson());
    } catch {
      // Le calque optionnel ne doit jamais interrompre le mode Vol.
    }
  };

  useEffect(() => {
    showPowerLinesRef.current = showPowerLines;
    if (!map.current?.getLayer(POWER_LINES_LAYER_ID)) return;
    for (const layerId of [POWER_LINES_CASING_LAYER_ID, POWER_LINES_LAYER_ID]) {
      map.current.setLayoutProperty(layerId, "visibility", showPowerLines ? "visible" : "none");
    }
    if (!showPowerLines) return;
    void fetchPowerLinesForViewport();
  }, [showPowerLines]);

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
    const projectionTimeMarkers = projectionTimeMarkersRef.current;

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
        layout: { visibility: baseMapRef.current === "plan" ? "visible" : "none" },
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
        layout: { visibility: baseMapRef.current === "satellite" ? "visible" : "none" },
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
      ...TWO_DIMENSIONAL_MAP_OPTIONS,
      attributionControl: {
        compact: true,
      },
    });

    // Ajouter les contrôles de navigation
    map.current.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: false,
        visualizePitch: false,
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

    map.current.on("moveend", () => {
      notifyViewportChange();
      void fetchPowerLinesForViewport();
    });
    map.current.on("dragstart", (event) => {
      if (!map.current || !followPositionRef.current) return;

      const originalEvent = event.originalEvent;
      const touchCount =
        originalEvent && "touches" in originalEvent
          ? originalEvent.touches.length
          : 1;
      if (
        shouldSuspendFollowForDrag({
          isZooming: map.current.isZooming(),
          touchCount,
        })
      ) {
        const nextFollowPosition = getFollowPositionAfterAction(
          followPositionRef.current,
          "MANUAL_DRAG",
        );
        followPositionRef.current = nextFollowPosition;
        onFollowPositionChangeRef.current?.(nextFollowPosition);
      }
    });
    map.current.on("zoomend", () => {
      if (!map.current) return;

      updateProjectionTimeMarkerVisibility(
        map.current,
        projectionTimeMarkersRef.current,
        gpsProjectionRef.current,
      );

      const position = currentPositionRef.current;
      if (followPositionRef.current && position) {
        followMapPosition(map.current, position, 0);
      }
    });

    map.current.on("click", (event) => {
      onMapPressRef.current?.();
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

      if (!map.current.getSource(POWER_LINES_SOURCE_ID)) {
        map.current.addSource(POWER_LINES_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
        });
      }
      void fetchPowerLinesForViewport();

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

      const powerLineLayout = {
        "line-cap": "round" as const,
        "line-join": "round" as const,
        visibility: showPowerLinesRef.current ? "visible" as const : "none" as const,
      };
      if (!map.current.getLayer(POWER_LINES_CASING_LAYER_ID)) {
        map.current.addLayer({
          id: POWER_LINES_CASING_LAYER_ID,
          type: "line",
          source: POWER_LINES_SOURCE_ID,
          filter: ["==", ["get", "power"], "line"],
          minzoom: 8,
          layout: powerLineLayout,
          paint: {
            "line-color": "rgba(7, 17, 31, 0.82)",
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4.6, 14, 7],
          },
        });
      }
      if (!map.current.getLayer(POWER_LINES_LAYER_ID)) {
        map.current.addLayer({
          id: POWER_LINES_LAYER_ID,
          type: "line",
          source: POWER_LINES_SOURCE_ID,
          filter: ["==", ["get", "power"], "line"],
          minzoom: 8,
          layout: powerLineLayout,
          paint: {
            "line-color": "#dc2626",
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.8, 14, 4.6],
            "line-opacity": 0.96,
          },
        });
      }

      map.current.addSource(PLANNED_TRAJECTORIES_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: plannedTrajectoriesRef.current.map((trajectory) => ({
            type: "Feature",
            properties: {
              modelId: trajectory.modelId,
              color: trajectory.color,
            },
            geometry: {
              type: "LineString",
              coordinates: trajectory.geometry,
            },
          })),
        },
      });
      map.current.addLayer({
        id: "planned-trajectories-halo",
        type: "line",
        source: PLANNED_TRAJECTORIES_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": PLANNED_TRAJECTORY_STYLE.haloColor,
          "line-width": PLANNED_TRAJECTORY_STYLE.haloWidth,
          "line-opacity": PLANNED_TRAJECTORY_STYLE.haloOpacity,
        },
      });
      for (const [modelId, style] of Object.entries(MODEL_LINE_STYLES)) {
        map.current.addLayer({
          id: `planned-trajectories-${modelId}`,
          type: "line",
          source: PLANNED_TRAJECTORIES_SOURCE_ID,
          filter: ["==", ["get", "modelId"], modelId],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": PLANNED_TRAJECTORY_STYLE.lineWidth,
            "line-opacity": PLANNED_TRAJECTORY_STYLE.lineOpacity,
            "line-dasharray": [...style.dasharray],
          },
        });
      }

      map.current.addSource("flight-track-source", {
        type: "geojson",
        data: buildFlightTrackData(flightPointsRef.current),
      });

      map.current.addLayer({
        id: "flight-track-halo",
        type: "line",
        source: "flight-track-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": FLIGHT_TRACK_STYLE.paint.haloColor,
          "line-width": FLIGHT_TRACK_STYLE.paint.haloWidth,
          "line-opacity": FLIGHT_TRACK_STYLE.paint.haloOpacity,
        },
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
          "line-color": FLIGHT_TRACK_STYLE.paint.lineColor,
          "line-width": FLIGHT_TRACK_STYLE.paint.lineWidth,
          "line-opacity": FLIGHT_TRACK_STYLE.paint.lineOpacity,
        },
      });

      map.current.addLayer({
        id: "flight-takeoff-halo",
        type: "circle",
        source: "flight-track-source",
        filter: ["==", ["get", "kind"], "takeoff"],
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.launchRadius,
          "circle-color": CARTOGRAPHY_PALETTE.launch,
          "circle-opacity": 0.2,
          "circle-stroke-color": CARTOGRAPHY_PALETTE.cloud,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.outerHaloWidth,
        },
      });

      map.current.addLayer({
        id: "flight-takeoff-point",
        type: "circle",
        source: "flight-track-source",
        filter: ["==", ["get", "kind"], "takeoff"],
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.launchRadius,
          "circle-color": CARTOGRAPHY_PALETTE.launch,
          "circle-stroke-color": CARTOGRAPHY_PALETTE.cloud,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.haloStrokeWidth,
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
        id: "gps-projection-halo",
        type: "line",
        source: "gps-projection-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": GPS_PROJECTION_STYLE.paint.haloColor,
          "line-width": GPS_PROJECTION_STYLE.paint.haloWidth,
          "line-opacity": GPS_PROJECTION_STYLE.paint.haloOpacity,
        },
      });

      map.current.addLayer({
        id: "gps-projection-line",
        type: "line",
        source: "gps-projection-source",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": GPS_PROJECTION_STYLE.paint.lineColor,
          "line-width": GPS_PROJECTION_STYLE.paint.lineWidth,
          "line-opacity": GPS_PROJECTION_STYLE.paint.lineOpacity,
        },
      });

      // Couche de points pour la projection GPS
      map.current.addLayer({
        id: "gps-projection-points",
        type: "circle",
        source: "gps-projection-source",
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.projectionPointRadius,
          "circle-color": CARTOGRAPHY_PALETTE.gpsProjection,
          "circle-opacity": 0.92,
          "circle-stroke-color": CARTOGRAPHY_PALETTE.ink,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.haloStrokeWidth,
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
          "line-color": WEATHER_PROJECTION_CARTOGRAPHY_STYLE.lineColor,
          "line-width": WEATHER_PROJECTION_CARTOGRAPHY_STYLE.lineWidth,
          "line-dasharray": [
            ...WEATHER_PROJECTION_CARTOGRAPHY_STYLE.dasharray,
          ],
          "line-opacity": WEATHER_PROJECTION_CARTOGRAPHY_STYLE.lineOpacity,
        },
      });

      // Couche de points pour la projection météo
      map.current.addLayer({
        id: "weather-projection-points",
        type: "circle",
        source: "weather-projection-source",
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.projectionPointRadius,
          "circle-color": CARTOGRAPHY_PALETTE.weatherProjection,
          "circle-opacity": 0.64,
          "circle-stroke-color": CARTOGRAPHY_PALETTE.ink,
          "circle-stroke-width": 1,
        },
      });

      // La trace réelle et le décollage restent au-dessus des projections.
      for (const layerId of [
        "flight-track-halo",
        "flight-track-line",
        "flight-takeoff-halo",
        "flight-takeoff-point",
      ]) {
        map.current.moveLayer(layerId);
      }

      sourceRef.current = true;
      const initialPosition = currentPositionRef.current;
      if (
        followPositionRef.current &&
        shouldApplyInitialCenter({
          hasValidPosition: Boolean(initialPosition),
          alreadyCentered: initialCenterCompletedRef.current,
        })
      ) {
        initialCenterCompletedRef.current = true;
        followMapPosition(map.current, initialPosition as GeoPoint, 220);
      }
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
        clearProjectionTimeMarkers(projectionTimeMarkers);
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
        accuracyHalo.style.background = `rgba(240, 163, 91, ${getPositionMarkerHaloOpacity(
          currentPosition.accuracy,
        )})`;
      }
      const arrow = markerContainer.querySelector("svg");
      const rotation = getPositionMarkerRotation(currentPosition.heading);
      if (arrow && rotation !== null) {
        lastMarkerHeadingRef.current = rotation;
        arrow.style.transform = `rotate(${rotation}deg)`;
      }
    } else {
      // Créer un élément pour le marqueur (flèche SVG)
      const el = document.createElement("div");
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "Position actuelle du pilote");
      el.style.width = `${CURRENT_POSITION_MARKER_STYLE.containerSize}px`;
      el.style.height = `${CURRENT_POSITION_MARKER_STYLE.containerSize}px`;
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      const markerRotation =
        getPositionMarkerRotation(currentPosition.heading) ??
        lastMarkerHeadingRef.current ??
        0;
      lastMarkerHeadingRef.current = markerRotation;
      const haloOpacity = getPositionMarkerHaloOpacity(
        currentPosition.accuracy,
      );
      el.innerHTML = `
        <div
          data-accuracy-halo
          style="width: ${CURRENT_POSITION_MARKER_STYLE.haloSize}px; height: ${CURRENT_POSITION_MARKER_STYLE.haloSize}px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(240, 163, 91, ${haloOpacity}); border: 2px solid rgba(243, 247, 251, 0.76); box-shadow: 0 4px 14px rgba(6, 17, 31, 0.48); transition: background-color 0.2s ease;"
        >
          <svg
            width="${CURRENT_POSITION_MARKER_STYLE.arrowSize}"
            height="${CURRENT_POSITION_MARKER_STYLE.arrowSize}"
            viewBox="0 0 24 24"
            fill="${CARTOGRAPHY_PALETTE.flightTrack}"
            stroke="${CARTOGRAPHY_PALETTE.cloud}"
            stroke-width="${CURRENT_POSITION_MARKER_STYLE.strokeWidth}"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="display: block; flex: none; filter: drop-shadow(0 3px 5px rgba(6, 17, 31, 0.82)); transform: rotate(${markerRotation}deg); transform-origin: 50% 50%; transition: transform 0.2s linear;"
          >
            <path d="M12 2L17 20L12 16L7 20L12 2Z"/>
          </svg>
        </div>
      `;

      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([currentPosition.longitude, currentPosition.latitude])
        .addTo(map.current);
    }

    if (followPositionRef.current) {
      const duration = initialCenterCompletedRef.current
        ? FOLLOW_CAMERA_DURATION_MS
        : 220;
      initialCenterCompletedRef.current = true;
      followMapPosition(map.current, currentPosition, duration);
    }
  }, [currentPosition]);

  useEffect(() => {
    if (!map.current || recenterRequest === lastRecenterRequestRef.current) {
      return;
    }

    lastRecenterRequestRef.current = recenterRequest;
    if (!currentPosition) {
      map.current.easeTo({ ...REFERENCE_ORIENTATION, duration: 220 });
      return;
    }
    followPositionRef.current = true;
    map.current.easeTo({
      center: [currentPosition.longitude, currentPosition.latitude],
      offset: getFollowCameraOffset(getMapViewportSize(map.current)),
      ...REFERENCE_ORIENTATION,
      duration: 220,
    });
  }, [currentPosition, recenterRequest]);

  useEffect(() => {
    if (
      !map.current ||
      !currentPosition ||
      fitProjectionRequest === lastFitProjectionRequestRef.current
    ) {
      return;
    }

    lastFitProjectionRequestRef.current = fitProjectionRequest;
    const visibleProjection = [
      ...(showGpsProjection ? gpsProjection : []),
      ...(showWeatherProjection ? weatherProjection : []),
    ];
    if (visibleProjection.length === 0) return;

    const bounds = new maplibregl.LngLatBounds(
      [currentPosition.longitude, currentPosition.latitude],
      [currentPosition.longitude, currentPosition.latitude],
    );
    for (const point of visibleProjection) {
      bounds.extend([point.longitude, point.latitude]);
    }

    const viewportSize = getMapViewportSize(map.current);
    const camera = map.current.cameraForBounds(bounds, {
      padding: getMapCameraInsets(viewportSize),
    });
    if (!camera) return;
    const fitZoom = camera.zoom ?? map.current.getZoom();

    followPositionRef.current = true;
    map.current.easeTo({
      center: [currentPosition.longitude, currentPosition.latitude],
      zoom: Math.max(map.current.getMinZoom(), fitZoom - 0.45),
      bearing: map.current.getBearing(),
      offset: getFollowCameraOffset(viewportSize),
      duration: 260,
    });
  }, [
    currentPosition,
    fitProjectionRequest,
    gpsProjection,
    showGpsProjection,
    showWeatherProjection,
    weatherProjection,
  ]);

  useEffect(() => {
    if (!map.current || !sourceRef.current) return;
    const source = map.current.getSource("flight-track-source") as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(buildFlightTrackData(flightPoints));
  }, [flightPoints]);

  useEffect(() => {
    if (!map.current) return;
    const source = map.current.getSource(PLANNED_TRAJECTORIES_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: plannedTrajectories.map((trajectory) => ({
        type: "Feature",
        properties: {
          modelId: trajectory.modelId,
          color: trajectory.color,
        },
        geometry: {
          type: "LineString",
          coordinates: trajectory.geometry,
        },
      })),
    });
  }, [plannedTrajectories]);

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

      syncProjectionTimeMarkers(
        map.current,
        projectionTimeMarkersRef.current,
        gpsProjection,
      );
      updateProjectionTimeMarkerVisibility(
        map.current,
        projectionTimeMarkersRef.current,
        gpsProjection,
      );

      // Afficher les couches
      if (map.current.getLayer("gps-projection-halo")) {
        map.current.setLayoutProperty(
          "gps-projection-halo",
          "visibility",
          "visible",
        );
      }
      if (map.current.getLayer("gps-projection-line")) {
        map.current.setLayoutProperty("gps-projection-line", "visibility", "visible");
      }
      if (map.current.getLayer("gps-projection-points")) {
        map.current.setLayoutProperty("gps-projection-points", "visibility", "visible");
      }
    } else {
      clearProjectionTimeMarkers(projectionTimeMarkersRef.current);
      // Masquer les couches
      if (map.current.getLayer("gps-projection-halo")) {
        map.current.setLayoutProperty(
          "gps-projection-halo",
          "visibility",
          "none",
        );
      }
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
        .flight-projection-time-marker {
          pointer-events: none;
          min-width: 34px;
          padding: 4px 6px;
          border: 1px solid rgba(88, 201, 154, 0.72);
          border-radius: 18px;
          background: rgba(6, 17, 31, 0.9);
          color: #f3f7fb;
          box-shadow: 0 4px 12px rgba(6, 17, 31, 0.38);
          font-size: 10px;
          font-weight: 900;
          line-height: 1;
          text-align: center;
          white-space: nowrap;
        }
        @media (max-width: 380px) {
          .flight-map .maplibregl-ctrl-attrib { max-width: 185px; }
          .flight-projection-time-marker {
            min-width: 30px;
            padding-inline: 5px;
            font-size: 9px;
          }
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
