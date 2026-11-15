/** Dataset contract only. Independent of the legacy OSM obstacles and power-line layers. */
export type ObstacleSource = "SIA" | "OSM" | "GEORISQUES";
export type ObstacleCategory = "wind_turbine" | "mast_antenna" | "chimney_flare" |
  "tower_structure" | "crane" | "particular_obstacle" | "aerial_cable" | "cable_support";
export type ObstaclePhysicalStatus = "existing" | "under_construction" | "planned" | "removed" | "unknown";
export type ObstacleAdministrativeStatus = "authorized" | "under_review" | "refused" | "unknown";
export type ObstaclePermanence = "permanent" | "temporary" | "unknown";
export type ObstacleMobility = "fixed" | "mobile" | "unknown";
export type ObstacleGeometryRole = "source_position" | "representative_point" | "group_point" | "source_trace";
export type ObstacleGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.MultiLineString;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type OriginalObstacleRecord = { [key: string]: JsonValue };
export type VerticalReference = "AGL" | "AMSL" | "ROOF" | "SUPPORT" | "UNKNOWN";

/** Datum is separate from AGL/AMSL: AMSL alone does not establish IGN69 or another datum. */
export interface ObstacleMeasurement {
  originalValue: string | number | null;
  originalUnit: string | null;
  unit: "m" | "ft" | null;
  valueM: number | null;
  reference: VerticalReference;
  datum: string | null;
  definition: string | null;
  sourceField: string;
  accuracyM: number | null;
  unknownReason: "missing" | "invalid_value" | "unknown_unit" | null;
}

export interface ObstacleSourceEdition {
  id: string;
  source: ObstacleSource;
  url: string | null;
  artifact: string;
  sha256: string;
  referenceDate: string | null;
  airacCycle: string | null;
  snapshotAtUtc: string | null;
  retrievedAtUtc: string | null;
  license: string | null;
  attribution: string;
}

export interface ObstacleIssue {
  code: string;
  detail: string;
}

export interface AeronauticalObstacleRecord {
  /** Stable source-qualified identity, never derived from array order or coordinates. */
  id: string;
  /** Content-addressed observation: revisions and conflicting same-version records coexist. */
  observationId: string;
  source: ObstacleSource;
  sourceId: string;
  sourceVersion: string | null;
  sourceEditionIds: string[];
  category: ObstacleCategory;
  sourceType: string | null;
  name: string | null;
  geometry: ObstacleGeometry;
  geometryRole: ObstacleGeometryRole;
  /** Scope of the source representation, never a count of physical obstacles. */
  recordScope: "single_feature" | "group" | "composite" | "component" | "unknown";
  horizontalDatum: string | null;
  horizontalAccuracyM: number | null;
  declaredCount: number | null;
  siteId: string | null;
  physicalStatus: ObstaclePhysicalStatus;
  administrativeStatus: ObstacleAdministrativeStatus;
  operationStatus: "operating" | "disused" | "unknown";
  statusEvidence: string[];
  permanence: ObstaclePermanence;
  mobility: ObstacleMobility;
  /** Unzoned source dates remain raw; never assign UTC to them implicitly. */
  dates: {
    effectiveDate: string | null;
    editedAtRaw: string | null;
    editedAtUtc: string | null;
    validFrom: string | null;
    validUntil: string | null;
  };
  measurements: {
    heightAgl: ObstacleMeasurement;
    topAmsl: ObstacleMeasurement;
    declaredHeight: ObstacleMeasurement;
    additional: ObstacleMeasurement[];
  };
  /** A SIA point for a cable does not establish its trace, sag or clearance. */
  verticalProfile: "known" | "unknown" | "not_applicable";
  lineage: { citedSources: string[]; independence: "not_established" };
  issues: ObstacleIssue[];
  original: OriginalObstacleRecord;
}

export interface ObstacleRecordLink {
  id: string;
  fromObservationId: string;
  toObservationId: string;
  relation: "possible_same_object" | "possible_colocation" | "possible_representation" | "same_source_variant" | "component_of" | "supports";
  decision: "candidate" | "ambiguous" | "confirmed" | "rejected";
  method: string;
  distanceM: number | null;
  distanceMethod: "point_haversine" | "point_trace_local_projection" | "not_computed";
  evidence: string[];
  alternatives: string[];
  heightComparison: {
    differenceM: number;
    comparableAgl: boolean;
    reviewRequired: boolean;
    reason: string;
  } | null;
}

export function obstacleSourceId(source: ObstacleSource, sourceId: string): string {
  if (!sourceId.trim()) throw new Error("Missing obstacle source identifier");
  return `${source}:${encodeURIComponent(sourceId)}`;
}

/** Unit conversion only: never computes an altitude from a height or vice versa. */
export function obstacleMeasurement(
  originalValue: string | number | null | undefined,
  originalUnit: string | null,
  reference: VerticalReference,
  datum: string | null,
  sourceField: string,
  definition: string | null = null,
): ObstacleMeasurement {
  const unitText = originalUnit?.trim().toLowerCase();
  const unit = unitText === "m" ? "m" : ["ft", "feet", "'"].includes(unitText ?? "") ? "ft" : null;
  const text = originalValue === null || originalValue === undefined ? "" : String(originalValue).trim().replace(",", ".");
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN;
  const unknownReason = !text ? "missing" : !Number.isFinite(numeric) ? "invalid_value" : !unit ? "unknown_unit" : null;
  return { originalValue: originalValue ?? null, originalUnit, unit,
    valueM: unknownReason ? null : numeric * (unit === "ft" ? 0.3048 : 1), reference,
    datum: datum?.trim() || null, definition, sourceField, accuracyM: null, unknownReason };
}
