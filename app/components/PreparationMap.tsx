"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  AIRSPACE_RENDER_ORDER,
  getAirspaceCategoryStyle,
  getAirspaceVisualCategory,
  prepareAirspacesForMap,
} from "../lib/airspaceMapStyle";
import {
  createAirspaceSelectionIndex,
  resolveRenderedAirspaces,
  type RenderedAirspaceFeature,
} from "../lib/airspaceSelection";
import { sortAirspacesForMapClick } from "../lib/airspaceMapSelection";
import type {
  AirspaceFeatureCollection,
  AirspaceGeoJsonProperties,
} from "../lib/openaip";
import { interpolateTrajectoryPoint } from "../lib/trajectory/mapProjection";
import { MODEL_LINE_STYLES } from "../lib/trajectory/analysisStyles";
import {
  ANALYSIS_TRAJECTORY_STYLE,
  CARTOGRAPHY_MARKER_STYLE,
  CARTOGRAPHY_PALETTE,
  TIME_MARKER_STYLE,
} from "../lib/cartographyStyle";
import {
  REFERENCE_ORIENTATION,
  TWO_DIMENSIONAL_MAP_OPTIONS,
} from "../lib/mapInteraction";
import type {
  AnalysisLayerSettings,
  WeatherAnalysisTrace,
} from "../lib/trajectory/weatherAnalysisStorage";
import type { BaseMap } from "../types/flight";
import type { AirspaceCoverageViewport } from "../hooks/useAirspaceCoverage";
import { analysisFitMaxZoom, analysisFitPadding, calculateTrajectoryBounds, countValidTrajectoryPoints, createTrajectoryFitKey, trajectoryContentKey, type BoundsLaunchSite } from "../lib/trajectory/trajectoryBounds";
import TrajectoryArrivalDetails from "./TrajectoryArrivalDetails";
import { landingWeatherSamplePoints } from "../lib/trajectoryArrivalSummary";

const EMPTY_AIRSPACES: AirspaceFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
const AIRSPACE_SOURCE = "analysis-airspaces";
const TRACE_SOURCE = "analysis-trajectories";
const TIME_SOURCE = "analysis-time-markers";
const ARRIVAL_SOURCE = "analysis-arrivals";
const START_SOURCE = "analysis-start";
const LANDING_ZONE_SOURCE = "analysis-landing-zone";

interface PreparationMapProps {
  traces: WeatherAnalysisTrace[];
  visibleTraceIds: string[];
  launchSiteName: string;
  launchSite: BoundsLaunchSite;
  analysisKey: string;
  baseMap: BaseMap;
  layers: AnalysisLayerSettings;
  airspaces?: AirspaceFeatureCollection;
  recenterToken?: number;
  onAirspacesSelected?: (airspaces: AirspaceGeoJsonProperties[]) => void;
  onMapPress?: () => void;
  onViewportChange?: (viewport: AirspaceCoverageViewport) => void;
  onArrivalSelectionChange?: (selected: boolean) => void;
}

function airspaceLayerId(category: string, kind: "fill" | "outline") {
  return `analysis-airspace-${category.toLowerCase().replaceAll("_", "-")}-${kind}`;
}

function traceCollection(
  traces: readonly WeatherAnalysisTrace[],
  visibleIds: readonly string[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const visible = new Set(visibleIds);
  return {
    type: "FeatureCollection",
    features: traces
      .filter((trace) => visible.has(trace.traceId))
      .map((trace) => ({
        type: "Feature",
        properties: {
          traceId: trace.traceId,
          modelId: trace.model.id,
          color: trace.color,
        },
        geometry: {
          type: "LineString",
          coordinates: trace.projection.points.map((point) => [
            point.longitude,
            point.latitude,
          ]),
        },
      })),
  };
}

function timeMarkerCollection(
  traces: readonly WeatherAnalysisTrace[],
  visibleIds: readonly string[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const visible = new Set(visibleIds);
  return {
    type: "FeatureCollection",
    features: traces
      .filter((trace) => visible.has(trace.traceId))
      .flatMap((trace) => {
        const markers = [];
        for (
          let minutes = 15;
          minutes * 60 < trace.projection.durationSeconds;
          minutes += 15
        ) {
          const point = interpolateTrajectoryPoint(
            trace.projection.points,
            minutes * 60,
          );
          if (point) {
            markers.push({
              minutes,
              latitude: point.latitude,
              longitude: point.longitude,
            });
          }
        }
        return markers.map((marker) => ({
            type: "Feature" as const,
            properties: {
              traceId: trace.traceId,
              label: `${marker.minutes} min`,
              color: trace.color,
            },
            geometry: {
              type: "Point" as const,
              coordinates: [marker.longitude, marker.latitude],
            },
          }));
      }),
  };
}

function arrivalCollection(
  traces: readonly WeatherAnalysisTrace[],
  visibleIds: readonly string[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const visible = new Set(visibleIds);
  return {
    type: "FeatureCollection",
    features: traces.flatMap((trace) => {
      if (!visible.has(trace.traceId)) return [];
      const point = trace.projection.points.at(-1);
      return point
        ? [
            {
              type: "Feature" as const,
              properties: {
                traceId: trace.traceId,
                color: trace.color,
                label: `${trace.model.label} · ${trace.label}`,
              },
              geometry: {
                type: "Point" as const,
                coordinates: [point.longitude, point.latitude],
              },
            },
          ]
        : [];
    }),
  };
}

function startCollection(
  launchSite: BoundsLaunchSite,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: Number.isFinite(launchSite.latitude) && Number.isFinite(launchSite.longitude)
      ? [
          {
            type: "Feature",
            properties: { kind: "start" },
            geometry: {
              type: "Point",
              coordinates: [launchSite.longitude, launchSite.latitude],
            },
          },
        ]
      : [],
  };
}

function landingZoneCollection(trace: WeatherAnalysisTrace | null): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const end = trace?.projection.points.at(-1);
  if (!end) return { type: "FeatureCollection", features: [] };
  const perimeter = landingWeatherSamplePoints(end.latitude, end.longitude).slice(1).map((point) => [point.longitude, point.latitude]);
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...perimeter, perimeter[0]]] } }] };
}

export default function PreparationMap({
  traces,
  visibleTraceIds,
  launchSiteName,
  launchSite,
  analysisKey,
  baseMap,
  layers,
  airspaces = EMPTY_AIRSPACES,
  recenterToken = 0,
  onAirspacesSelected,
  onMapPress,
  onViewportChange,
  onArrivalSelectionChange,
}: PreparationMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const lastCompletedTrajectoryFitKey = useRef("");
  const [mapDimensions, setMapDimensions] = useState({ width: 0, height: 0 });
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const viewportRef = useRef(onViewportChange);
  const selectionRef = useRef(onAirspacesSelected);
  const mapPressRef = useRef(onMapPress);
  const arrivalSelectionRef = useRef(onArrivalSelectionChange);
  const airspacesRef = useRef(airspaces);
  const showAirspacesRef = useRef(layers.airspaces);
  const indexRef = useRef(createAirspaceSelectionIndex(airspaces));
  const mapTilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ?? "";
  const initialLatitude = launchSite.latitude;
  const initialLongitude = launchSite.longitude;
  const traceData = useMemo(
    () => traceCollection(traces, visibleTraceIds),
    [traces, visibleTraceIds],
  );
  const timeData = useMemo(
    () => timeMarkerCollection(traces, visibleTraceIds),
    [traces, visibleTraceIds],
  );
  const arrivalData = useMemo(
    () => arrivalCollection(traces, visibleTraceIds),
    [traces, visibleTraceIds],
  );
  const startData = useMemo(() => startCollection(launchSite), [launchSite]);
  const initialTraceData = useRef(traceData);
  const initialTimeData = useRef(timeData);
  const initialArrivalData = useRef(arrivalData);
  const initialStartData = useRef(startData);
  const selectedTrace = traces.find((trace) => trace.traceId === selectedTraceId) ?? null;
  const landingZoneData = useMemo(() => landingZoneCollection(selectedTrace), [selectedTrace]);

  useEffect(() => {
    viewportRef.current = onViewportChange;
    selectionRef.current = onAirspacesSelected;
    mapPressRef.current = onMapPress;
    arrivalSelectionRef.current = onArrivalSelectionChange;
  }, [onAirspacesSelected, onArrivalSelectionChange, onMapPress, onViewportChange]);

  useEffect(() => {
    airspacesRef.current = airspaces;
    showAirspacesRef.current = layers.airspaces;
    indexRef.current = createAirspaceSelectionIndex(airspaces);
  }, [airspaces, layers.airspaces]);

  useEffect(() => {
    if (
      !container.current ||
      mapRef.current ||
      initialLatitude === undefined ||
      initialLongitude === undefined
    )
      return;
    const sources: Record<string, maplibregl.SourceSpecification> = {
      "osm-tiles": {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>',
      },
    };
    const styleLayers: maplibregl.LayerSpecification[] = [
      { id: "plan-base", type: "raster", source: "osm-tiles" },
    ];
    if (mapTilerKey) {
      sources["maptiler-satellite"] = {
        type: "raster",
        tiles: [
          `https://api.maptiler.com/maps/hybrid-v4/256/{z}/{x}/{y}@2x.jpg?key=${encodeURIComponent(mapTilerKey)}`,
        ],
        tileSize: 256,
        maxzoom: 22,
        attribution:
          '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>',
      };
      styleLayers.push({
        id: "satellite-base",
        type: "raster",
        source: "maptiler-satellite",
      });
    }
    const map = new maplibregl.Map({
      container: container.current,
      style: { version: 8, sources, layers: styleLayers },
      center: [initialLongitude, initialLatitude],
      zoom: 11,
      ...TWO_DIMENSIONAL_MAP_OPTIONS,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: false,
        visualizePitch: false,
      }),
      "bottom-right",
    );
    const notify = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      viewportRef.current?.({
        latitude: center.lat,
        longitude: center.lng,
        bounds: {
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
        },
      });
    };
    map.on("moveend", notify);
    map.on("click", (event) => {
      mapPressRef.current?.();
      const arrival = map.queryRenderedFeatures(
        [[event.point.x - 14, event.point.y - 14], [event.point.x + 14, event.point.y + 14]],
        { layers: map.getLayer("analysis-arrivals") ? ["analysis-arrivals"] : [] },
      )[0];
      const traceId = arrival?.properties?.traceId;
      if (typeof traceId === "string") {
        setSelectedTraceId(traceId);
        arrivalSelectionRef.current?.(true);
        return;
      }
      if (!showAirspacesRef.current) return;
      const layerIds = AIRSPACE_RENDER_ORDER.flatMap((category) => [
        airspaceLayerId(category, "fill"),
        airspaceLayerId(category, "outline"),
      ]).filter((id) => Boolean(map.getLayer(id)));
      const rendered = map.queryRenderedFeatures(
        [
          [event.point.x - 8, event.point.y - 8],
          [event.point.x + 8, event.point.y + 8],
        ],
        { layers: layerIds },
      );
      const resolved = resolveRenderedAirspaces(
        rendered as RenderedAirspaceFeature[],
        indexRef.current,
      );
      const byId = new Map(
        airspacesRef.current.features.map((feature) => [
          feature.properties.airspaceId,
          feature,
        ]),
      );
      const selected = sortAirspacesForMapClick({
        candidates: resolved.flatMap((airspace) => {
          const feature = byId.get(airspace.airspaceId);
          return feature ? [{ airspace, geometry: feature.geometry }] : [];
        }),
        zoom: map.getZoom(),
      }).map((item) => item.airspace);
      selectionRef.current?.(selected);
    });
    map.on("load", () => {
      map.addSource(AIRSPACE_SOURCE, {
        type: "geojson",
        data: EMPTY_AIRSPACES,
        attribution:
          '<a href="https://www.openaip.net/" target="_blank">© openAIP</a> — CC BY-NC 4.0',
      });
      for (const category of AIRSPACE_RENDER_ORDER) {
        const style = getAirspaceCategoryStyle(category);
        const filter: maplibregl.FilterSpecification = [
          "==",
          ["get", "visualCategory"],
          category,
        ];
        map.addLayer({
          id: airspaceLayerId(category, "fill"),
          type: "fill",
          source: AIRSPACE_SOURCE,
          filter,
          minzoom: style.minZoom,
          ...(style.maxZoom === undefined ? {} : { maxzoom: style.maxZoom }),
          layout: { visibility: "none" },
          paint: {
            "fill-color": style.color,
            "fill-opacity": style.fillOpacity,
          },
        });
        map.addLayer({
          id: airspaceLayerId(category, "outline"),
          type: "line",
          source: AIRSPACE_SOURCE,
          filter,
          minzoom: style.minZoom,
          ...(style.maxZoom === undefined ? {} : { maxzoom: style.maxZoom }),
          layout: { visibility: "none" },
          paint: {
            "line-color": style.color,
            "line-width": style.lineWidth,
            "line-opacity": style.lineOpacity,
          },
        });
      }
      map.addSource(TRACE_SOURCE, {
        type: "geojson",
        data: initialTraceData.current,
      });
      map.addLayer({
        id: "analysis-trajectory-halo",
        type: "line",
        source: TRACE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ANALYSIS_TRAJECTORY_STYLE.haloColor,
          "line-width": ANALYSIS_TRAJECTORY_STYLE.haloWidth,
          "line-opacity": ANALYSIS_TRAJECTORY_STYLE.haloOpacity,
        },
      });
      for (const [modelId, lineStyle] of Object.entries(MODEL_LINE_STYLES)) {
        map.addLayer({
          id: `analysis-trajectory-${modelId}`,
          type: "line",
          source: TRACE_SOURCE,
          filter: ["==", ["get", "modelId"], modelId],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ANALYSIS_TRAJECTORY_STYLE.lineWidth,
            "line-opacity": ANALYSIS_TRAJECTORY_STYLE.lineOpacity,
            "line-dasharray": [...lineStyle.dasharray],
          },
        });
      }
      map.addSource(TIME_SOURCE, {
        type: "geojson",
        data: initialTimeData.current,
      });
      map.addLayer({
        id: "analysis-time-markers",
        type: "symbol",
        source: TIME_SOURCE,
        layout: {
          "text-field": ["get", "label"],
          "text-size": TIME_MARKER_STYLE.textSize,
          "text-font": ["Open Sans Bold"],
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": TIME_MARKER_STYLE.textColor,
          "text-halo-color": ["get", "color"],
          "text-halo-width": TIME_MARKER_STYLE.haloWidth,
          "text-halo-blur": 0.5,
        },
      });
      map.addSource(ARRIVAL_SOURCE, {
        type: "geojson",
        data: initialArrivalData.current,
      });
      map.addLayer({
        id: "analysis-arrivals-halo",
        type: "circle",
        source: ARRIVAL_SOURCE,
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.arrivalRadius,
          "circle-color": CARTOGRAPHY_PALETTE.ink,
          "circle-stroke-color": CARTOGRAPHY_PALETTE.cloud,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.outerHaloWidth,
          "circle-opacity": 0.78,
        },
      });
      map.addLayer({
        id: "analysis-arrivals",
        type: "circle",
        source: ARRIVAL_SOURCE,
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.arrivalRadius,
          "circle-color": ["get", "color"],
          "circle-stroke-color": CARTOGRAPHY_PALETTE.ink,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.haloStrokeWidth,
        },
      });
      map.addSource(START_SOURCE, {
        type: "geojson",
        data: initialStartData.current,
      });
      map.addSource(LANDING_ZONE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "analysis-landing-zone-fill", type: "fill", source: LANDING_ZONE_SOURCE, paint: { "fill-color": "#38bdf8", "fill-opacity": 0.08 } });
      map.addLayer({ id: "analysis-landing-zone-outline", type: "line", source: LANDING_ZONE_SOURCE, paint: { "line-color": "#7dd3fc", "line-width": 1.5, "line-opacity": 0.72, "line-dasharray": [3, 2] } });
      map.addLayer({
        id: "analysis-start-halo",
        type: "circle",
        source: START_SOURCE,
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.launchRadius,
          "circle-color": CARTOGRAPHY_PALETTE.launch,
          "circle-opacity": 0.24,
          "circle-stroke-color": CARTOGRAPHY_PALETTE.cloud,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.outerHaloWidth,
        },
      });
      map.addLayer({
        id: "analysis-start",
        type: "circle",
        source: START_SOURCE,
        paint: {
          "circle-radius": CARTOGRAPHY_MARKER_STYLE.launchRadius,
          "circle-color": CARTOGRAPHY_PALETTE.launch,
          "circle-stroke-color": CARTOGRAPHY_PALETTE.cloud,
          "circle-stroke-width": CARTOGRAPHY_MARKER_STYLE.haloStrokeWidth,
        },
      });
      notify();
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [initialLatitude, initialLongitude, mapTilerKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      (map.getSource(TRACE_SOURCE) as GeoJSONSource | undefined)?.setData(
        traceData,
      );
      (map.getSource(TIME_SOURCE) as GeoJSONSource | undefined)?.setData(
        timeData,
      );
      (map.getSource(ARRIVAL_SOURCE) as GeoJSONSource | undefined)?.setData(
        arrivalData,
      );
      (map.getSource(START_SOURCE) as GeoJSONSource | undefined)?.setData(
        startData,
      );
      const trajectoryVisibility = layers.trajectories ? "visible" : "none";
      for (const id of [
        "analysis-trajectory-halo",
        ...Object.keys(MODEL_LINE_STYLES).map(
          (modelId) => `analysis-trajectory-${modelId}`,
        ),
      ]) {
        if (map.getLayer(id))
          map.setLayoutProperty(id, "visibility", trajectoryVisibility);
      }
      if (map.getLayer("analysis-time-markers"))
        map.setLayoutProperty(
          "analysis-time-markers",
          "visibility",
          layers.timeMarkers ? "visible" : "none",
        );
      if (map.getLayer("analysis-arrivals"))
        map.setLayoutProperty(
          "analysis-arrivals",
          "visibility",
          layers.arrivalMarkers ? "visible" : "none",
        );
      if (map.getLayer("analysis-arrivals-halo"))
        map.setLayoutProperty(
          "analysis-arrivals-halo",
          "visibility",
          layers.arrivalMarkers ? "visible" : "none",
        );
    };
    if (map.loaded()) sync();
    else map.once("load", sync);
    return () => {
      map.off("load", sync);
    };
  }, [arrivalData, layers.arrivalMarkers, layers.timeMarkers, layers.trajectories, startData, timeData, traceData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => (map.getSource(LANDING_ZONE_SOURCE) as GeoJSONSource | undefined)?.setData(landingZoneData);
    if (map.loaded()) sync();
    else map.once("load", sync);
    return () => { map.off("load", sync); };
  }, [landingZoneData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      const satellite = Boolean(map.getLayer("satellite-base"));
      map.setLayoutProperty(
        "plan-base",
        "visibility",
        baseMap === "plan" || !satellite ? "visible" : "none",
      );
      if (satellite)
        map.setLayoutProperty(
          "satellite-base",
          "visibility",
          baseMap === "satellite" ? "visible" : "none",
        );
      for (const id of ["plan-base", "satellite-base"]) {
        if (map.getLayer(id)) {
          map.setPaintProperty(
            id,
            "raster-contrast",
            layers.highContrast ? 0.35 : 0,
          );
        }
      }
    };
    if (map.loaded()) sync();
    else map.once("load", sync);
    return () => {
      map.off("load", sync);
    };
  }, [baseMap, layers.highContrast]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      const prepared = prepareAirspacesForMap(airspaces, {
        currentAltitudeMeters: null,
      });
      (map.getSource(AIRSPACE_SOURCE) as GeoJSONSource | undefined)?.setData({
        ...prepared,
        features: prepared.features.map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            visualCategory: getAirspaceVisualCategory(feature.properties),
          },
        })),
      });
      for (const category of AIRSPACE_RENDER_ORDER) {
        for (const kind of ["fill", "outline"] as const) {
          const id = airspaceLayerId(category, kind);
          if (map.getLayer(id))
            map.setLayoutProperty(
              id,
              "visibility",
              layers.airspaces ? "visible" : "none",
            );
          if (kind === "outline" && map.getLayer(id)) {
            const style = getAirspaceCategoryStyle(category);
            map.setPaintProperty(
              id,
              "line-width",
              layers.aeronauticalMap ? style.lineWidth + 1 : style.lineWidth,
            );
          }
        }
      }
    };
    if (map.loaded()) sync();
    else map.once("load", sync);
    return () => {
      map.off("load", sync);
    };
  }, [airspaces, layers.aeronauticalMap, layers.airspaces]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const updateDimensions = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setMapDimensions((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };
    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visible = new Set(visibleTraceIds);
    const visibleTraces = traces.filter((trace) => visible.has(trace.traceId));
    const rawPointCount = visibleTraces.reduce((total, trace) => total + trace.projection.points.length, 0);
    const pointCount = countValidTrajectoryPoints(visibleTraces);
    if (!analysisKey || pointCount === 0) return;
    const bounds = calculateTrajectoryBounds(visibleTraces, launchSite);
    if (!bounds) return;
    const fitKey = createTrajectoryFitKey({
      analysisKey,
      visibleTraceIds,
      width: mapDimensions.width,
      height: mapDimensions.height,
      recenterToken,
      trajectoryKey: trajectoryContentKey(visibleTraces),
    });
    if (fitKey === lastCompletedTrajectoryFitKey.current) return;
    let idleListenerAttached = false;
    let fallbackFrame = 0;
    let cancelled = false;
    const fitVisibleTrajectoryBounds = () => {
      if (cancelled || mapRef.current !== map) return;
      map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], {
        padding: analysisFitPadding(map.getContainer().clientWidth),
        maxZoom: analysisFitMaxZoom(map.getContainer().clientWidth),
        ...REFERENCE_ORIENTATION,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520,
      });
      lastCompletedTrajectoryFitKey.current = fitKey;
      if (process.env.NODE_ENV === "development") {
        const endpoints = visibleTraces.map((trace) => ({ traceId: trace.traceId, first: trace.projection.points[0] ?? null, last: trace.projection.points.at(-1) ?? null }));
        map.once("moveend", () => console.debug("[trajectory-fit]", { origin: recenterToken ? "manual" : "automatic-idle", fitKey, analysisKey, traceCount: visibleTraces.length, rawPointCount, usedPointCount: pointCount, endpoints, bounds, center: map.getCenter(), zoom: map.getZoom(), timestamp: new Date().toISOString() }));
      }
    };
    const handleIdle = () => {
      idleListenerAttached = false;
      if (cancelled || fitKey === lastCompletedTrajectoryFitKey.current) return;
      fitVisibleTrajectoryBounds();
    };
    const scheduleTrajectoryFit = () => {
      map.resize();
      map.once("idle", handleIdle);
      idleListenerAttached = true;
      fallbackFrame = window.requestAnimationFrame(() => {
        if (
          !cancelled &&
          map.loaded() &&
          map.isStyleLoaded() &&
          fitKey !== lastCompletedTrajectoryFitKey.current
        ) {
          if (idleListenerAttached) map.off("idle", handleIdle);
          idleListenerAttached = false;
          fitVisibleTrajectoryBounds();
        }
      });
    };
    scheduleTrajectoryFit();
    return () => {
      cancelled = true;
      if (idleListenerAttached) map.off("idle", handleIdle);
      window.cancelAnimationFrame(fallbackFrame);
    };
  }, [analysisKey, launchSite, mapDimensions.height, mapDimensions.width, recenterToken, traces, visibleTraceIds]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      {selectedTrace && <TrajectoryArrivalDetails trace={selectedTrace} airspaces={airspaces} onClose={() => { setSelectedTraceId(null); arrivalSelectionRef.current?.(false); }} />}
      <span className="sr-only">Départ : {launchSiteName}</span>
    </div>
  );
}
