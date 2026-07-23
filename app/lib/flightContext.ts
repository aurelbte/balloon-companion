import type { Position } from "geojson";
import {
  calculateAirspaceVerticalContext,
  normalizeOpenAipAltitudeLimit,
  type AirspaceVerticalContext,
} from "./airspaceAltitude.ts";
import type {
  AirspaceFeatureCollection,
  AirspaceGeoJsonProperties,
  AirspaceGeometry,
} from "./openaip.ts";

export type FlightContextGpsStatus =
  | "UNAVAILABLE"
  | "ACQUIRING"
  | "ACTIVE"
  | "STALE";

export type FlightContextAirspaceStatus =
  | "UNAVAILABLE"
  | "OUTSIDE_LOADED_DATA"
  | "NO_MATCH"
  | "HORIZONTAL_MATCH"
  | "CONFIRMED";

export interface LoadedAirspaceCoverage {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface CurrentAirspaceContext {
  airspace: AirspaceGeoJsonProperties;
  horizontalState: "INSIDE";
  verticalContext: AirspaceVerticalContext;
  isVerticallyConfirmed: boolean;
  displayPriority: number;
}

export interface FlightContext {
  gps: {
    latitude: number | null;
    longitude: number | null;
    altitudeMeters: number | null;
    horizontalAccuracyMeters: number | null;
    verticalAccuracyMeters: number | null;
    timestamp: number | null;
    status: FlightContextGpsStatus;
  };
  airspace: {
    current: CurrentAirspaceContext | null;
    containing: CurrentAirspaceContext[];
    horizontalCandidates: CurrentAirspaceContext[];
    status: FlightContextAirspaceStatus;
  };
}

export interface FlightContextInput {
  gps: FlightContext["gps"];
  airspaces: AirspaceFeatureCollection;
  loadedCoverage: LoadedAirspaceCoverage[];
  airspaceDataAvailable: boolean;
}

export interface FindContainingAirspacesInput {
  position: {
    latitude: number;
    longitude: number;
  };
  airspaces: AirspaceFeatureCollection;
  altitudeMeters: number | null;
  verticalAccuracyMeters: number | null;
}

export const OPENAIP_AIRSPACE_DISPLAY_PRIORITY: Readonly<
  Record<number, number>
> = {
  1: 10, // Restricted
  2: 10, // Danger
  3: 10, // Prohibited
  4: 20, // CTR
  13: 30, // ATZ
  5: 40, // TMZ
  6: 40, // RMZ
  7: 50, // TMA
  26: 60, // CTA
  14: 70, // MATZ
  23: 70, // TIZ
  24: 70, // TIA
  27: 70, // ACC Sector
  36: 70, // MCTR
  33: 80, // FIS Sector
  10: 90, // FIR
  11: 90, // UIR
};

const UNKNOWN_TYPE_PRIORITY = 500;
const EARTH_RADIUS_METERS = 6_371_000;
const CONCISE_AIRSPACE_TYPE_LABELS: Readonly<Record<number, string>> = {
  4: "CTR",
  5: "TMZ",
  6: "RMZ",
  7: "TMA",
  13: "ATZ",
  26: "CTA",
  33: "FIS",
};

function isPointOnSegment(
  point: Position,
  start: Position,
  end: Position,
): boolean {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (y - y1) * (x2 - x1) - (x - x1) * (y2 - y1);
  if (Math.abs(cross) > 1e-10) return false;

  return (
    x >= Math.min(x1, x2) - 1e-10 &&
    x <= Math.max(x1, x2) + 1e-10 &&
    y >= Math.min(y1, y2) - 1e-10 &&
    y <= Math.max(y1, y2) + 1e-10
  );
}

function isPointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (isPointOnSegment(point, previousPoint, currentPoint)) return true;

    const [x, y] = point;
    const [currentX, currentY] = currentPoint;
    const [previousX, previousY] = previousPoint;
    const intersects =
      currentY > y !== previousY > y &&
      x <
        ((previousX - currentX) * (y - currentY)) /
          (previousY - currentY) +
          currentX;
    if (intersects) inside = !inside;
  }

  return inside;
}

function isPointInPolygonCoordinates(
  point: Position,
  coordinates: Position[][],
): boolean {
  if (coordinates.length === 0 || !isPointInRing(point, coordinates[0])) {
    return false;
  }

  return !coordinates.slice(1).some((hole) => isPointInRing(point, hole));
}

export function isPositionInsideAirspaceGeometry(
  position: { latitude: number; longitude: number },
  geometry: AirspaceGeometry,
): boolean {
  const point: Position = [position.longitude, position.latitude];
  if (geometry.type === "Polygon") {
    return isPointInPolygonCoordinates(point, geometry.coordinates);
  }

  return geometry.coordinates.some((polygon) =>
    isPointInPolygonCoordinates(point, polygon),
  );
}

function ringArea(ring: Position[]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function polygonArea(coordinates: Position[][]): number {
  if (coordinates.length === 0) return Number.POSITIVE_INFINITY;
  return Math.max(
    0,
    ringArea(coordinates[0]) -
      coordinates.slice(1).reduce((sum, hole) => sum + ringArea(hole), 0),
  );
}

function geometryArea(geometry: AirspaceGeometry): number {
  return geometry.type === "Polygon"
    ? polygonArea(geometry.coordinates)
    : geometry.coordinates.reduce(
        (sum, polygon) => sum + polygonArea(polygon),
        0,
      );
}

export function getAirspaceDisplayPriority(type: number): number {
  return OPENAIP_AIRSPACE_DISPLAY_PRIORITY[type] ?? UNKNOWN_TYPE_PRIORITY;
}

export function findContainingAirspaces({
  position,
  airspaces,
  altitudeMeters,
  verticalAccuracyMeters,
}: FindContainingAirspacesInput): CurrentAirspaceContext[] {
  return airspaces.features
    .filter((feature) =>
      isPositionInsideAirspaceGeometry(position, feature.geometry),
    )
    .map((feature) => {
      const verticalContext = calculateAirspaceVerticalContext(
        normalizeOpenAipAltitudeLimit(feature.properties.lowerLimit),
        normalizeOpenAipAltitudeLimit(feature.properties.upperLimit),
        altitudeMeters,
        verticalAccuracyMeters,
      );

      return {
        context: {
          airspace: feature.properties,
          horizontalState: "INSIDE" as const,
          verticalContext,
          isVerticallyConfirmed: verticalContext.state === "INSIDE",
          displayPriority: getAirspaceDisplayPriority(feature.properties.type),
        },
        area: geometryArea(feature.geometry),
      };
    })
    .sort(
      (left, right) =>
        left.context.displayPriority - right.context.displayPriority ||
        Number(right.context.isVerticallyConfirmed) -
          Number(left.context.isVerticallyConfirmed) ||
        left.area - right.area ||
        left.context.airspace.airspaceId.localeCompare(
          right.context.airspace.airspaceId,
        ),
    )
    .map(({ context }) => context);
}

function distanceMeters(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
): number {
  const latitudeDelta = ((second.latitude - first.latitude) * Math.PI) / 180;
  const longitudeDelta = ((second.longitude - first.longitude) * Math.PI) / 180;
  const firstLatitude = (first.latitude * Math.PI) / 180;
  const secondLatitude = (second.latitude * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function isPositionCoveredByAirspaceData(
  position: { latitude: number; longitude: number },
  loadedCoverage: LoadedAirspaceCoverage[],
): boolean {
  return loadedCoverage.some(
    (coverage) =>
      distanceMeters(position, coverage) <= coverage.radiusMeters * 0.85,
  );
}

export function buildFlightContext({
  gps,
  airspaces,
  loadedCoverage,
  airspaceDataAvailable,
}: FlightContextInput): FlightContext {
  const unavailable = {
    current: null,
    containing: [],
    horizontalCandidates: [],
  };

  if (
    gps.status === "UNAVAILABLE" ||
    gps.status === "ACQUIRING" ||
    gps.latitude === null ||
    gps.longitude === null
  ) {
    return {
      gps,
      airspace: { ...unavailable, status: "UNAVAILABLE" },
    };
  }

  if (!airspaceDataAvailable) {
    return {
      gps,
      airspace: { ...unavailable, status: "UNAVAILABLE" },
    };
  }

  const position = { latitude: gps.latitude, longitude: gps.longitude };
  if (!isPositionCoveredByAirspaceData(position, loadedCoverage)) {
    return {
      gps,
      airspace: { ...unavailable, status: "OUTSIDE_LOADED_DATA" },
    };
  }

  const horizontalCandidates = findContainingAirspaces({
    position,
    airspaces,
    altitudeMeters: gps.altitudeMeters,
    verticalAccuracyMeters: gps.verticalAccuracyMeters,
  });
  const containing = horizontalCandidates.filter(
    ({ verticalContext }) =>
      verticalContext.state === "INSIDE" ||
      verticalContext.state === "UNKNOWN",
  );
  const current = containing[0] ?? null;

  return {
    gps,
    airspace: {
      current,
      containing,
      horizontalCandidates,
      status:
        horizontalCandidates.length === 0
          ? "NO_MATCH"
          : current?.isVerticallyConfirmed
            ? "CONFIRMED"
            : "HORIZONTAL_MATCH",
    },
  };
}

export interface AirspaceBadgePresentation {
  label: string;
  ariaLabel: string;
  tone: "blue" | "red" | "neutral";
  interactive: boolean;
}

export function getAirspaceBadgePresentation(
  context: FlightContext,
  operationalFrequency: {
    status: "AVAILABLE" | "UNAVAILABLE";
    value: string | null;
    stationName: string | null;
    sourceAirspaceId: string | null;
  },
): AirspaceBadgePresentation {
  if (context.gps.status === "UNAVAILABLE") {
    return {
      label: "Position indisponible",
      ariaLabel: "Position GPS indisponible",
      tone: "neutral",
      interactive: false,
    };
  }
  if (context.gps.status === "ACQUIRING") {
    return {
      label: "Recherche GPS…",
      ariaLabel: "Recherche de la position GPS",
      tone: "neutral",
      interactive: false,
    };
  }
  if (context.gps.status === "STALE") {
    return {
      label: "Position ancienne",
      ariaLabel: "La dernière position GPS est ancienne",
      tone: "neutral",
      interactive: false,
    };
  }
  if (context.airspace.status === "UNAVAILABLE") {
    return {
      label: "Espaces indisponibles",
      ariaLabel: "Données des espaces aériens indisponibles",
      tone: "neutral",
      interactive: false,
    };
  }
  if (context.airspace.status === "OUTSIDE_LOADED_DATA") {
    return {
      label: "Hors données chargées",
      ariaLabel: "Position hors de l’étendue des données aéronautiques chargées",
      tone: "neutral",
      interactive: false,
    };
  }
  if (!context.airspace.current) {
    return {
      label: "Aucun espace identifié",
      ariaLabel:
        "Aucun espace aérien identifié dans les données disponibles, sans conclusion sur la classe de l’espace",
      tone: "neutral",
      interactive: false,
    };
  }

  const current = context.airspace.current;
  const conciseTypeLabel =
    CONCISE_AIRSPACE_TYPE_LABELS[current.airspace.type];
  const displayName =
    conciseTypeLabel &&
    !new RegExp(`\\b${conciseTypeLabel}\\b`, "i").test(current.airspace.name)
      ? `${conciseTypeLabel} ${current.airspace.name}`
      : current.airspace.name;
  const isLocalFis =
    current.airspace.type === 33 &&
    operationalFrequency.status === "AVAILABLE" &&
    operationalFrequency.sourceAirspaceId === current.airspace.airspaceId;
  const fields = [
    isLocalFis && operationalFrequency.stationName
      ? operationalFrequency.stationName
      : displayName,
    current.airspace.icaoClassLabel === "Classe inconnue" ||
    current.airspace.icaoClassLabel === "Unclassified / SUA" ||
    isLocalFis
      ? null
      : current.airspace.icaoClassLabel,
    operationalFrequency.status === "AVAILABLE"
      ? operationalFrequency.value
      : null,
  ].filter((field): field is string => Boolean(field));
  const isUncertain = !current.isVerticallyConfirmed;
  const type = current.airspace.type;

  return {
    label: `${fields.join(" · ")}${isUncertain ? " · ?" : ""}`,
    ariaLabel: isUncertain
      ? `${fields.join(", ")}. Présence horizontale détectée, position verticale non confirmée`
      : fields.join(", "),
    tone: [1, 2, 3].includes(type)
      ? "red"
      : [4, 7, 26].includes(type)
        ? "blue"
        : "neutral",
    interactive: true,
  };
}
