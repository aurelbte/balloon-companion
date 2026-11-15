import { createHash } from "node:crypto";
import { obstacleMeasurement, obstacleSourceId } from "../../app/lib/aeronauticalObstacles.ts";
import type { AeronauticalObstacleRecord, JsonValue, ObstacleCategory, ObstacleMeasurement,
  ObstacleRecordLink, ObstacleSource, OriginalObstacleRecord, ObstacleGeometry } from "../../app/lib/aeronauticalObstacles.ts";

type Raw = OriginalObstacleRecord;
export const METHOD = "three-zone-candidates-v2-no-automatic-merge";
export const CENTRE = [1.5047, 49.8804] as const;
export const RADIUS_M = 15_000;
const text = (value: JsonValue | undefined): string | null => typeof value === "string" && value.trim() ? value : null;
const number = (value: JsonValue | undefined): number | null => {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (String(value).trim() === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
function object(value: JsonValue | undefined): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const absent = (field: string, reference: "AGL" | "AMSL") => obstacleMeasurement(null, null, reference, null, field);

function base(source: ObstacleSource, sourceId: string, raw: Raw, category: ObstacleCategory,
  lon: number | null, lat: number | null, editions: string[]): AeronauticalObstacleRecord {
  if (lon === null || lat === null || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error(`Invalid coordinates: ${source}:${sourceId}`);
  const id = obstacleSourceId(source, sourceId);
  return { id, observationId: `${id}@${sha256(canonical(raw))}`, source, sourceId,
    sourceVersion: null, sourceEditionIds: [...editions].sort(), category, sourceType: null, name: null,
    geometry: { type: "Point", coordinates: [lon, lat] }, geometryRole: "source_position", recordScope: "single_feature",
    horizontalDatum: "WGS84", horizontalAccuracyM: null, declaredCount: null, siteId: null,
    physicalStatus: "unknown", administrativeStatus: "unknown", operationStatus: "unknown", statusEvidence: [],
    permanence: "unknown", mobility: "unknown",
    dates: { effectiveDate: null, editedAtRaw: null, editedAtUtc: null, validFrom: null, validUntil: null },
    measurements: { heightAgl: absent("heightAgl", "AGL"), topAmsl: absent("topAmsl", "AMSL"),
      declaredHeight: obstacleMeasurement(null, null, "UNKNOWN", null, "declaredHeight"), additional: [] },
    verticalProfile: category === "aerial_cable" ? "unknown" : "not_applicable",
    lineage: { citedSources: [], independence: "not_established" }, issues: [], original: raw };
}

function taggedMeasure(raw: JsonValue | undefined, field: string): ObstacleMeasurement {
  const value = text(raw);
  const match = value?.trim().match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(m|ft|feet|')?$/i);
  const measure = obstacleMeasurement(match?.[1] ?? value, match ? match[2] ?? "m" : null, "UNKNOWN", null, field);
  // Preserve the complete tag, including any explicit unit, in addition to its parsed value.
  measure.originalValue = value;
  return measure;
}

export function normalizeSia(raw: Raw, editions: string[]): AeronauticalObstacleRecord {
  const type = text(raw.TYPE) ?? "";
  const category: ObstacleCategory = /[ÉE]olienne/i.test(type) ? "wind_turbine" : /c[âa]ble/i.test(type) ? "aerial_cable" :
    /m[âa]t|antenne/i.test(type) ? "mast_antenna" : /chemin[ée]e/i.test(type) ? "chimney_flare" :
    /tour|silo|ch[âa]teau|b[âa]timent/i.test(type) ? "tower_structure" : /grue/i.test(type) ? "crane" : "particular_obstacle";
  const r = base("SIA", text(raw.IDENTIFICATEUR) ?? "", raw, category,
    number(raw["LONGITUDE DECIMALE"]), number(raw["LATITUDE DECIMALE"]), editions);
  r.sourceType = type; r.declaredCount = number(raw.NOMBRE);
  r.horizontalDatum = text(raw["SYSTEME DE REFERENCE HORIZONTALE"]);
  if (r.horizontalDatum !== "WGS84") throw new Error(`Unsupported SIA horizontal datum: ${r.id}`);
  r.horizontalAccuracyM = taggedMeasure(raw["PRECISION HORIZONTALE"], "PRECISION HORIZONTALE").valueM;
  const unit = text(raw.UNITE), datum = text(raw["SYSTEME REFERENCE VERTICALE"]);
  r.measurements.heightAgl = obstacleMeasurement(text(raw["HAUTEUR HORS SOL"]), unit, "AGL", null, "HAUTEUR HORS SOL", "Published height above ground");
  r.measurements.topAmsl = obstacleMeasurement(text(raw["ALTITUDE AU SOMMET"]), unit, "AMSL", datum, "ALTITUDE AU SOMMET", "Published obstacle top");
  const accuracy = taggedMeasure(raw["PRECISION VERTICALE"], "PRECISION VERTICALE").valueM;
  r.measurements.heightAgl.accuracyM = accuracy; r.measurements.topAmsl.accuracyM = accuracy;
  r.measurements.declaredHeight = { ...r.measurements.heightAgl };
  const date = text(raw["DATE DE MISE EN VIGUEUR"]);
  r.dates.effectiveDate = date && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null;
  r.geometryRole = r.declaredCount !== null && r.declaredCount > 1 ? "group_point" :
    category === "aerial_cable" || /lin[ée]aire/i.test(text(raw["TYPE GEOMETRIE"]) ?? "") ? "representative_point" : "source_position";
  const remark = text(raw.REMARQUE) ?? "";
  r.recordScope = r.declaredCount !== null && r.declaredCount > 1 ? "group" : remark.includes("+") ? "composite" : "single_feature";
  if (r.recordScope !== "single_feature") r.issues.push({ code: "NON_INDIVIDUAL_REPRESENTATION", detail: "Group/composite source record; do not count as an additional individual component" });
  r.statusEvidence = ["Published ENR 5.4; publication alone does not prove current physical presence"];
  if (/pyl[ôo]ne/i.test(type)) r.issues.push({ code: "AMBIGUOUS_PYLON_USE", detail: "SIA pylon retained; electrical use not inferred" });
  if (category === "aerial_cable") r.issues.push({ code: "CABLE_TRACE_UNAVAILABLE", detail: "Source point retained; no trace or vertical profile inferred" });
  if (!datum) r.issues.push({ code: "UNKNOWN_VERTICAL_DATUM", detail: "Published top retained without assigning a vertical datum" });
  return r;
}

export function normalizeGeorisques(raw: Raw, editions: string[]): AeronauticalObstacleRecord {
  const r = base("GEORISQUES", text(raw.id_aerogenerateur) ?? "", raw, "wind_turbine", number(raw.longitude), number(raw.latitude), editions);
  r.sourceType = "aerogenerateur"; r.name = text(raw.nom_eolienne); r.siteId = text(raw.id_parc);
  const state = text(raw.etat_parc), admin = text(raw.statut_parc);
  r.physicalStatus = state === "En exploitation" ? "existing" : state === "En construction" ? "under_construction" :
    state === "En attente de construction" ? "planned" : "unknown";
  r.operationStatus = state === "En exploitation" ? "operating" : "unknown";
  r.administrativeStatus = admin === "Autorisé" ? "authorized" : admin === "En instruction" ? "under_review" : "unknown";
  r.statusEvidence = ["Park lifecycle reported for turbine; no independent field verification", state, admin].filter((x): x is string => x !== null);
  r.measurements.heightAgl = obstacleMeasurement(text(raw.hauteur_totale), "m", "AGL", null, "hauteur_totale", "Declared total turbine height");
  r.measurements.declaredHeight = { ...r.measurements.heightAgl };
  r.measurements.additional = [
    obstacleMeasurement(text(raw.hauteur_mat_nacelle), "m", "AGL", null, "hauteur_mat_nacelle", "Mast/nacelle, not total tip height"),
    obstacleMeasurement(text(raw.cote_ngf), "m", "UNKNOWN", null, "cote_ngf", "Raw NGF value; precise vertical target and datum not attested"),
  ];
  r.dates.editedAtRaw = text(raw.date_maj); // No timezone supplied; editedAtUtc stays null.
  r.issues.push({ code: "TOP_ALTITUDE_UNAVAILABLE", detail: "No cote_ngf + height computation" });
  return r;
}

const lifecycleValues = (tags: Raw, key: string) => [tags[key], ...["construction", "proposed", "disused", "abandoned", "demolished", "razed", "removed"].map(p => tags[`${p}:${key}`])];
/** Shared by normalization and the exclusion ledger, so rejection reasons cannot diverge. */
export function osmExclusionReason(raw: Raw): string | null {
  const tags = object(raw.tags);
  if (lifecycleValues(tags, "power").some(v => v === "tower" || v === "pole")) return "ordinary_electric_support";
  if (raw.selection_reason === "context_peak" || ["peak", "cliff", "rock", "bare_rock", "ridge"].includes(String(tags.natural)) || tags.waterway === "waterfall") return "natural_terrain_context";
  if (["letter_box", "post_box"].includes(String(tags.amenity))) return "non_aeronautical_or_suspect_units";
  if (!osmCategory(tags)) return tags.obstacle ? "ground_obstacle_or_unsupported_category" : "unsupported_or_non_aeronautical_category";
  return null;
}
function osmCategory(tags: Raw): ObstacleCategory | null {
  const values = (key: string) => lifecycleValues(tags, key);
  if (values("generator:source").includes("wind") || values("generator:method").includes("wind_turbine")) return "wind_turbine";
  if (values("aerialway").includes("pylon")) return "cable_support";
  if (values("aerialway").some(v => ["zip_line", "zipline", "cable_car", "gondola", "chair_lift", "drag_lift", "goods", "platter"].includes(String(v))) || ["zip_line", "zipline"].includes(String(tags.attraction))) return "aerial_cable";
  const types = values("man_made");
  if (types.some(t => ["mast", "antenna", "communications_tower"].includes(String(t)))) return "mast_antenna";
  if (types.some(t => ["chimney", "flare"].includes(String(t)))) return "chimney_flare";
  if (types.includes("crane") || tags["seamark:type"] === "crane") return "crane";
  if (types.some(t => ["tower", "water_tower", "silo", "windmill", "cooling_tower", "gasometer"].includes(String(t)))) return "tower_structure";
  if (["building", "building:part"].some(k => values(k).some(v => text(v) && v !== "no"))) return "tower_structure";
  if (tags.pipeline === "surge_tank") return "particular_obstacle";
  return tags.aeroway === "obstacle" ? "particular_obstacle" : null;
}

function sourceGeometry(value: JsonValue | undefined): ObstacleGeometry | null {
  const g = object(value);
  const point = (v: JsonValue): boolean => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === "number" && Number.isFinite(x)) && Math.abs(Number(v[0])) <= 180 && Math.abs(Number(v[1])) <= 90;
  const line = (v: JsonValue): boolean => Array.isArray(v) && v.length >= 2 && v.every(point);
  if (g.type === "Point" && point(g.coordinates)) return g as unknown as GeoJSON.Point;
  if (g.type === "LineString" && line(g.coordinates)) return g as unknown as GeoJSON.LineString;
  if (g.type === "MultiLineString" && Array.isArray(g.coordinates) && g.coordinates.length && g.coordinates.every(line)) return g as unknown as GeoJSON.MultiLineString;
  return null;
}

export function normalizeOsm(raw: Raw, editions: string[]): AeronauticalObstacleRecord | null {
  if (osmExclusionReason(raw)) return null;
  const tags = object(raw.tags), category = osmCategory(tags);
  if (!category) return null;
  const sourceId = text(raw.id) ?? "";
  if (!/^(node|way|relation)\/[1-9]\d*$/.test(sourceId)) throw new Error(`Invalid OSM identity: ${sourceId}`);
  const g = sourceGeometry(raw.geometry);
  if (raw.geometry !== undefined && !g) throw new Error(`Invalid source geometry: ${sourceId}`);
  const anchor = g?.type === "Point" ? g.coordinates : g?.type === "LineString" ? g.coordinates[0] : g?.coordinates[0][0];
  const r = base("OSM", sourceId, raw, category, number(raw.longitude) ?? anchor?.[0] ?? null, number(raw.latitude) ?? anchor?.[1] ?? null, editions);
  if (g) r.geometry = g;
  r.geometryRole = g && g.type !== "Point" ? "source_trace" : text(raw.position_method) === "node" ? "source_position" : "representative_point";
  r.sourceVersion = number(raw.osm_version)?.toString() ?? null;
  r.sourceType = text(tags.man_made) ?? text(tags.aerialway) ?? text(tags.attraction) ??
    (text(tags["building:part"]) && tags["building:part"] !== "no" ? "building:part" : text(tags.building) ? "building" : text(tags.pipeline)) ?? text(tags.power); r.name = text(tags.name);
  r.recordScope = text(tags["building:part"]) && tags["building:part"] !== "no" ? "component" : "single_feature";
  const keys = Object.keys(tags);
  const prefixed = (prefix: string) => keys.some(k => k.startsWith(`${prefix}:`));
  const removed = prefixed("demolished") || prefixed("removed") || prefixed("razed");
  r.physicalStatus = removed ? "removed" : prefixed("proposed") || tags.proposed === "yes" ? "planned" :
    prefixed("construction") || tags.power === "construction" || text(tags.construction) ? "under_construction" : "unknown";
  r.operationStatus = prefixed("disused") || prefixed("abandoned") || tags.disused === "yes" ? "disused" : "unknown";
  r.statusEvidence = ["OSM lifecycle tags retained; unqualified cartography is not proof of current physical presence"];
  r.mobility = text(tags["crane:mobile"]) && !["no", "false"].includes(String(tags["crane:mobile"]).toLowerCase()) ? "mobile" : "unknown";
  r.permanence = tags.temporary === "yes" ? "temporary" : tags.temporary === "no" ? "permanent" : "unknown";
  r.measurements.declaredHeight = taggedMeasure(tags.height, "height");
  // A dimension on a roof/support is not a demonstrated total AGL height.
  r.measurements.additional = [taggedMeasure(tags.ele, "ele"), taggedMeasure(tags["height:hub"], "height:hub")];
  r.dates.editedAtRaw = text(raw.osm_timestamp_utc);
  const stamp = r.dates.editedAtRaw;
  r.dates.editedAtUtc = stamp && /(Z|[+-]\d{2}:\d{2})$/.test(stamp) && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null;
  r.lineage.citedSources = Object.entries(tags).filter(([k]) => k === "source" || k.startsWith("source:")).flatMap(([, v]) => text(v) ? [String(v)] : []);
  r.issues.push({ code: "HEIGHT_REFERENCE_UNATTESTED", detail: "OSM height retained as declared dimension; AGL and summit not inferred" });
  if (r.geometryRole === "representative_point") r.issues.push({ code: "PROXY_GEOMETRY", detail: "Study centroid only; native geometry unavailable in this extraction" });
  if (category === "aerial_cable" && r.geometry.type === "Point") r.issues.push({ code: "CABLE_TRACE_UNAVAILABLE", detail: "Point is not a cable trace" });
  return r;
}

export function distanceM(a: readonly number[], b: readonly number[]): number {
  const rad = Math.PI / 180;
  const h = Math.sin((a[1] - b[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((a[0] - b[0]) * rad / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local 2D projection for candidate selection only, never terrain/clearance or identity. */
export function geometryDistanceM(point: readonly number[], geometry: ObstacleGeometry): number {
  if (geometry.type === "Point") return distanceM(point, geometry.coordinates);
  const rad = Math.PI / 180, scale = 6371008.8 * rad;
  const project = (p: number[]) => [(p[0] - point[0]) * scale * Math.cos(point[1] * rad), (p[1] - point[1]) * scale];
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  let nearest = Infinity;
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const a = project(line[i - 1]), b = project(line[i]), dx = b[0] - a[0], dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length2)) : 0;
    nearest = Math.min(nearest, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return nearest;
}

export function deduplicateObservations(records: AeronauticalObstacleRecord[]) {
  const unique = new Map<string, AeronauticalObstacleRecord>();
  let duplicateObservations = 0;
  for (const record of records) {
    const previous = unique.get(record.observationId);
    if (previous) {
      duplicateObservations++;
      unique.set(record.observationId, { ...previous, sourceEditionIds: [...new Set([...previous.sourceEditionIds, ...record.sourceEditionIds])].sort() });
    } else unique.set(record.observationId, record);
  }
  return { records: [...unique.values()].sort((a, b) => a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0), duplicateObservations };
}

function compatible(a: AeronauticalObstacleRecord, b: AeronauticalObstacleRecord) {
  if (a.category === b.category) return true;
  // SIA "Pylône" is deliberately not classified as an electrical support.
  return [a, b].some(r => r.issues.some(i => i.code === "AMBIGUOUS_PYLON_USE")) &&
    [a, b].every(r => ["particular_obstacle", "tower_structure", "mast_antenna"].includes(r.category));
}

function heightComparison(a: AeronauticalObstacleRecord, b: AeronauticalObstacleRecord): ObstacleRecordLink["heightComparison"] {
  const ma = a.measurements.declaredHeight, mb = b.measurements.declaredHeight;
  if (ma.valueM === null || mb.valueM === null) return null;
  const comparableAgl = ma.reference === "AGL" && mb.reference === "AGL" && a.recordScope === "single_feature" && b.recordScope === "single_feature";
  const differenceM = Math.abs(ma.valueM - mb.valueM);
  return { differenceM, comparableAgl, reviewRequired: differenceM > 5,
    reason: comparableAgl ? "Declared AGL difference; 5 m review signal only, not a regulatory tolerance or proven source error" :
      "Declared dimensions only; unknown/different references or group/composite/component scope prevent a demonstrated AGL contradiction" };
}

/** Candidate graph only: no union-find, no synthetic entity and no automatic confirmation. */
export function relateRecords(records: AeronauticalObstacleRecord[]): ObstacleRecordLink[] {
  const links: ObstacleRecordLink[] = [];
  const ordered = [...records].sort((a, b) => a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0);
  for (let i = 0; i < ordered.length; i++) for (const b of ordered.slice(i + 1)) {
    const a = ordered[i], sameIdentity = a.id === b.id;
    const points = a.geometry.type === "Point" && b.geometry.type === "Point";
    const pointTrace = !points && a.source !== b.source && a.category === "aerial_cable" && b.category === "aerial_cable" &&
      (a.geometry.type === "Point" || b.geometry.type === "Point");
    if (!sameIdentity && !points && !pointTrace) continue;
    const point = a.geometry.type === "Point" ? a : b, trace = point === a ? b : a;
    const distance = points ? distanceM((a.geometry as GeoJSON.Point).coordinates, (b.geometry as GeoJSON.Point).coordinates) :
      pointTrace ? geometryDistanceM((point.geometry as GeoJSON.Point).coordinates, trace.geometry) : null;
    const sameSource = a.source === b.source, family = compatible(a, b);
    if (!sameIdentity && (distance === null || distance > (sameSource ? 20 : 150))) continue;
    const representation = pointTrace || [a, b].some(r => ["group", "composite", "component"].includes(r.recordScope));
    const height = pointTrace ? null : heightComparison(a, b);
    const evidence = [family ? "compatible_category" : "different_categories", "proximity_is_not_identity", "source_independence_not_established"];
    if (a.physicalStatus !== b.physicalStatus) evidence.push("different_physical_statuses");
    if (a.geometryRole !== "source_position" || b.geometryRole !== "source_position") evidence.push("representative_or_group_geometry");
    if (height?.reviewRequired) evidence.push("height_difference_review");
    if (representation) evidence.push(pointTrace ? "point_trace_context_only_no_identity_or_vertical_profile" : "group_composite_or_component_not_individual_identity");
    links.push({ id: `link:${sha256(canonical([a.observationId, b.observationId]))}`, fromObservationId: a.observationId, toObservationId: b.observationId,
      relation: sameIdentity ? "same_source_variant" : representation && !sameSource ? "possible_representation" : sameSource || !family ? "possible_colocation" : "possible_same_object",
      decision: sameIdentity || !family || sameSource || representation ? "ambiguous" : "candidate", method: METHOD, distanceM: distance,
      distanceMethod: points ? "point_haversine" : pointTrace ? "point_trace_local_projection" : "not_computed",
      evidence, alternatives: [], heightComparison: height });
  }
  const byId = new Map(ordered.map(r => [r.observationId, r]));
  for (const link of links) {
    const a = byId.get(link.fromObservationId)!, b = byId.get(link.toObservationId)!;
    link.alternatives = links.filter(other => other.id !== link.id && ["possible_same_object", "possible_representation"].includes(other.relation) &&
      ((other.fromObservationId === a.observationId && byId.get(other.toObservationId)?.source === b.source) ||
       (other.toObservationId === a.observationId && byId.get(other.fromObservationId)?.source === b.source) ||
       (other.fromObservationId === b.observationId && byId.get(other.toObservationId)?.source === a.source) ||
       (other.toObservationId === b.observationId && byId.get(other.fromObservationId)?.source === a.source)))
      .map(other => other.id).sort();
    if (link.alternatives.length) { link.decision = "ambiguous"; link.evidence.push("multiple_candidates_same_source"); }
  }
  return links;
}
