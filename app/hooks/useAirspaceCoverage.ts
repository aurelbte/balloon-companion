import { useEffect, useMemo, useState } from "react";
import { IndexedDbAirspaceCache, type CachedAirspaceTile } from "../lib/airspaceCache";
import {
  AirspaceHttpError,
  AirspaceTimeoutError,
  classifyAirspaceError,
  getAirspaceUiPresentation,
  type AirspaceFailure,
  type AirspaceUiState,
} from "../lib/airspaceLoadState";
import { mergeAirspacesById } from "../lib/airspaceMerge";
import {
  getAirspaceTileForPosition,
  getAirspaceTileById,
  getAirspaceTilesForBounds,
  getNeighboringAirspaceTiles,
  type AirspaceTile,
  type GeographicBounds,
} from "../lib/airspaceTiles";
import type { GeoPoint } from "../types/flight";
import type { LoadedAirspaceCoverage } from "../lib/flightContext";
import {
  AirspaceTileLoader,
  aggregateAirspaceCoverageStatus,
  type AirspaceCoverageStatus,
  type AirspaceTileStatus,
} from "../services/airspaceTileLoader";
import {
  mergeAirspaceFeatureCollections,
  openAipAirspacesToGeoJson,
  type AirspaceFeatureCollection,
  type OpenAipAirspaceResponse,
} from "../lib/openaip";

const MAX_VISIBLE_AIRSPACE_TILES = 24;
const MAX_ACTIVE_AIRSPACE_TILES = 36;
const EXPLORATION_MARGIN_DEGREES = 0.15;
const EXPLORATION_DEBOUNCE_MS = 600;
const AIRSPACE_REQUEST_TIMEOUT_MS = 12_000;
const EMPTY_AIRSPACES: AirspaceFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export interface AirspaceCoverageViewport {
  latitude: number;
  longitude: number;
  bounds: GeographicBounds;
}

interface UseAirspaceCoverageInput {
  position: GeoPoint | null;
  isPositionStale: boolean;
  viewport: AirspaceCoverageViewport | null;
  explorationEnabled: boolean;
}

export interface UseAirspaceCoverageResult {
  airspaces: AirspaceFeatureCollection;
  loadedCoverage: LoadedAirspaceCoverage[];
  gpsCoverage: AirspaceCoverageStatus;
  visibleCoverage: AirspaceCoverageStatus;
  visibleLoading: boolean;
  statusMessage: string | null;
  uiState: AirspaceUiState;
  lastUpdatedAt: number | null;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function fetchAirspaceTile(
  tile: AirspaceTile,
  signal?: AbortSignal,
): Promise<AirspaceFeatureCollection> {
  const searchParams = new URLSearchParams({
    lat: String(tile.center.latitude),
    lon: String(tile.center.longitude),
    dist: String(tile.requestRadiusMeters),
  });
  let merged: AirspaceFeatureCollection = EMPTY_AIRSPACES;
  let nextPage: number | undefined;
  let pageCount = 0;

  do {
    if (nextPage !== undefined) searchParams.set("page", String(nextPage));
    const requestUrl = `/api/openaip/airspaces?${searchParams}`;
    const controller = new AbortController();
    let timedOut = false;
    const startedAt = Date.now();
    const handleExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", handleExternalAbort, { once: true });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, AIRSPACE_REQUEST_TIMEOUT_MS);

    if (process.env.NODE_ENV === "development") {
      console.debug("[Airspaces] request", {
        endpoint: "/api/openaip/airspaces",
        tileId: tile.tileId,
        page: nextPage ?? 1,
        online: navigator.onLine,
      });
    }

    let payload: OpenAipAirspaceResponse;
    try {
      const response = await fetch(requestUrl, {
        signal: controller.signal,
      });
      if (process.env.NODE_ENV === "development") {
        console.debug("[Airspaces] response", {
          tileId: tile.tileId,
          status: response.status,
          durationMs: Date.now() - startedAt,
          online: navigator.onLine,
        });
      }
      if (!response.ok) {
        throw new AirspaceHttpError(
          response.status,
          parseRetryAfter(response.headers.get("retry-after")),
        );
      }
      payload = (await response.json()) as OpenAipAirspaceResponse;
      if (
        !payload ||
        typeof payload !== "object" ||
        !Array.isArray(payload.items)
      ) {
        throw new SyntaxError("Invalid OpenAIP response");
      }
    } catch (error) {
      const classifiedError = timedOut
        ? new AirspaceTimeoutError()
        : error;
      if (process.env.NODE_ENV === "development") {
        const failure = classifyAirspaceError(
          classifiedError,
          navigator.onLine,
        );
        console.warn("[Airspaces] request failed", {
          tileId: tile.tileId,
          category: failure.category,
          httpStatus: failure.httpStatus,
          durationMs: Date.now() - startedAt,
          online: navigator.onLine,
        });
      }
      throw classifiedError;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", handleExternalAbort);
    }

    merged = mergeAirspaceFeatureCollections(
      merged,
      openAipAirspacesToGeoJson(payload),
    );
    nextPage = payload.nextPage;
    pageCount += 1;
  } while (nextPage !== undefined && pageCount < 50);

  return merged;
}

function nearestTiles(
  tiles: AirspaceTile[],
  latitude: number,
  longitude: number,
): AirspaceTile[] {
  return [...tiles]
    .sort((left, right) => {
      const leftDistance =
        (left.center.latitude - latitude) ** 2 +
        (left.center.longitude - longitude) ** 2;
      const rightDistance =
        (right.center.latitude - latitude) ** 2 +
        (right.center.longitude - longitude) ** 2;
      return leftDistance - rightDistance;
    })
    .slice(0, MAX_VISIBLE_AIRSPACE_TILES);
}

export function useAirspaceCoverage({
  position,
  isPositionStale,
  viewport,
  explorationEnabled,
}: UseAirspaceCoverageInput): UseAirspaceCoverageResult {
  const [activeTiles, setActiveTiles] = useState<
    Map<string, CachedAirspaceTile>
  >(new Map());
  const [statuses, setStatuses] = useState<Map<string, AirspaceTileStatus>>(
    new Map(),
  );
  const [visibleTileIds, setVisibleTileIds] = useState<string[]>([]);
  const [visibleCoverageTruncated, setVisibleCoverageTruncated] = useState(false);
  const [failures, setFailures] = useState<Map<string, AirspaceFailure>>(
    new Map(),
  );
  const [networkRetryKey, setNetworkRetryKey] = useState(0);
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [loader] = useState(
    () =>
      new AirspaceTileLoader({
        cache: new IndexedDbAirspaceCache(),
        fetchTile: fetchAirspaceTile,
        maxConcurrency: 2,
        maxAttempts: 3,
        isOnline: () =>
          typeof navigator === "undefined" || navigator.onLine,
        onStatusChange: (tileId, status) => {
          if (status !== "ERROR") {
            setFailures((current) => {
              if (!current.has(tileId)) return current;
              const next = new Map(current);
              next.delete(tileId);
              return next;
            });
          }
          setStatuses((current) => {
            const next = new Map(current);
            next.set(tileId, status);
            return next;
          });
        },
        onLoadError: (tileId, failure) => {
          setFailures((current) => {
            const next = new Map(current);
            next.set(tileId, failure);
            return next;
          });
          if (process.env.NODE_ENV === "development") {
            console.warn("[Airspaces] fallback", {
              tileId,
              category: failure.category,
              httpStatus: failure.httpStatus,
              online: navigator.onLine,
            });
          }
        },
        onTileUpdate: (tile, _status, source) => {
          if (process.env.NODE_ENV === "development") {
            console.debug("[Airspaces] tile available", {
              tileId: tile.tileId,
              source,
              featureCount: tile.airspaces.length,
              ageMs: Date.now() - tile.fetchedAt,
            });
          }
          setActiveTiles((current) => {
            const next = new Map(current);
            next.delete(tile.tileId);
            next.set(tile.tileId, tile);
            while (next.size > MAX_ACTIVE_AIRSPACE_TILES) {
              const oldest = next.keys().next().value as string | undefined;
              if (!oldest) break;
              next.delete(oldest);
            }
            return next;
          });
        },
      }),
  );

  useEffect(() => {
    const handleOffline = () => setIsOnline(false);
    const handleOnline = () => {
      setIsOnline(true);
      window.setTimeout(() => {
        setNetworkRetryKey((current) => current + 1);
      }, 250);
    };

    const initialStatusTimeout = window.setTimeout(() => {
      setIsOnline(navigator.onLine);
    }, 0);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearTimeout(initialStatusTimeout);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const gpsTileId =
    position && !isPositionStale
      ? getAirspaceTileForPosition(
          position.latitude,
          position.longitude,
        ).tileId
      : null;
  const gpsTiles = useMemo(() => {
    if (!gpsTileId || isPositionStale) return [];
    const tile = getAirspaceTileById(gpsTileId);
    if (!tile) return [];
    return [
      tile,
      ...getNeighboringAirspaceTiles(tile).filter(
        (neighbor) => neighbor.tileId !== tile.tileId,
      ),
    ];
  }, [gpsTileId, isPositionStale]);
  const gpsTileIds = useMemo(
    () => gpsTiles.map((tile) => tile.tileId),
    [gpsTiles],
  );

  useEffect(() => {
    for (const tile of gpsTiles) void loader.requestTile(tile, "GPS");
  }, [gpsTiles, loader, networkRetryKey]);

  useEffect(() => {
    if (!explorationEnabled || !viewport) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const allTiles = getAirspaceTilesForBounds(
        viewport.bounds,
        EXPLORATION_MARGIN_DEGREES,
      );
      const tiles = nearestTiles(
        allTiles,
        viewport.latitude,
        viewport.longitude,
      );
      setVisibleCoverageTruncated(allTiles.length > tiles.length);
      setVisibleTileIds(tiles.map((tile) => tile.tileId));
      for (const tile of tiles) {
        void loader.requestTile(tile, "EXPLORATION", controller.signal);
      }
    }, EXPLORATION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [explorationEnabled, loader, networkRetryKey, viewport]);
  const effectiveVisibleTileIds = useMemo(
    () => (explorationEnabled ? visibleTileIds : []),
    [explorationEnabled, visibleTileIds],
  );

  const activeIds = useMemo(
    () => new Set([...gpsTileIds, ...effectiveVisibleTileIds]),
    [effectiveVisibleTileIds, gpsTileIds],
  );
  const relevantTiles = useMemo(
    () =>
      [...activeTiles.values()].filter((tile) => activeIds.has(tile.tileId)),
    [activeIds, activeTiles],
  );
  const airspaces = useMemo(
    () =>
      relevantTiles.length === 0
        ? EMPTY_AIRSPACES
        : mergeAirspacesById(
            relevantTiles,
            process.env.NODE_ENV === "development"
              ? (airspaceId) =>
                  console.warn("[Airspaces] incompatible cached versions", {
                    airspaceId,
                  })
              : undefined,
          ),
    [relevantTiles],
  );
  const gpsCoverage = useMemo(
    () => aggregateAirspaceCoverageStatus(gpsTileIds, statuses),
    [gpsTileIds, statuses],
  );
  const visibleCoverage = useMemo(() => {
    const aggregate = aggregateAirspaceCoverageStatus(
      effectiveVisibleTileIds,
      statuses,
    );
    return explorationEnabled &&
      visibleCoverageTruncated &&
      aggregate.status === "COMPLETE"
      ? { ...aggregate, status: "PARTIAL" as const }
      : aggregate;
  }, [
    effectiveVisibleTileIds,
    explorationEnabled,
    statuses,
    visibleCoverageTruncated,
  ]);
  const lastUpdatedAt =
    relevantTiles.length > 0
      ? Math.max(...relevantTiles.map((tile) => tile.fetchedAt))
      : null;
  const visibleIdSet = useMemo(
    () => new Set(effectiveVisibleTileIds),
    [effectiveVisibleTileIds],
  );
  const visibleHasData = relevantTiles.some(
    (tile) =>
      visibleIdSet.has(tile.tileId) && tile.airspaces.length > 0,
  );
  const visibleFailures = effectiveVisibleTileIds.flatMap((tileId) => {
    const failure = failures.get(tileId);
    return failure ? [failure] : [];
  });
  const effectiveFailures =
    visibleFailures.length > 0 || isOnline
      ? visibleFailures
      : [{ category: "OFFLINE" as const, httpStatus: null }];
  const uiPresentation = getAirspaceUiPresentation({
    explorationEnabled,
    coverageStatus: visibleCoverage.status,
    failures: effectiveFailures,
    hasData: visibleHasData,
    staleCacheUsed: visibleCoverage.fromCache,
  });
  const statusMessage = uiPresentation.message;
  const loadedCoverage = useMemo(
    () =>
      relevantTiles.map((tile) => ({
        latitude: (tile.bounds.south + tile.bounds.north) / 2,
        longitude: (tile.bounds.west + tile.bounds.east) / 2,
        radiusMeters: 45_000,
      })),
    [relevantTiles],
  );

  return {
    airspaces,
    loadedCoverage,
    gpsCoverage,
    visibleCoverage,
    visibleLoading: visibleCoverage.status === "LOADING",
    statusMessage,
    uiState: uiPresentation.state,
    lastUpdatedAt,
  };
}
