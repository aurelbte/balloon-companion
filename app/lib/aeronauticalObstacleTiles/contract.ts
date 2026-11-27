/** Reader of the unchanged 2A wire contract. Generator imports below are TYPE ONLY. */
import type { TILE_POLICY, TileFeature } from "../../../prototypes/aeronautical-obstacles/tiles.ts";
import type { ObstacleSourceEdition, AeronauticalObstacleRecord, ObstacleMeasurement } from "../aeronauticalObstacles.ts";
import { tileBounds, tileXY, type Bounds } from "../../../prototypes/aeronautical-obstacles/tileGeometry.ts";
export type { TileFeature };
export type ErrorCode = "INVALID_MANIFEST" | "INVALID_GEOJSON" | "HASH_MISMATCH" | "HTTP_404" | "HTTP_410" | "HTTP_ERROR" | "NETWORK_ERROR" | "TIMEOUT" | "CANCELLED" | "CRYPTO_UNAVAILABLE" | "BODY_TOO_LARGE" | "IDENTITY_CONFLICT";
export class ObstacleTileError extends Error {
  readonly code: ErrorCode; readonly httpStatus?: number;
  constructor(code: ErrorCode, httpStatus?: number) { super(code); this.code = code; this.httpStatus = httpStatus; this.name = "ObstacleTileError"; }
}
export type Artifact = { bytes: number; sha256: string; contentType: string; contentEncoding?: "gzip"; decodedSha256?: string };
export type TileEntry = Artifact & { key: string; z: 9 | 12; x: number; y: number; bbox: Bounds;
  coverage: "study_full" | "study_partial" | "native_data_extension"; status: "empty" | "data"; features: number;
  classes: Record<string, number>; categories: Record<string, number>; gzipBytes: number; gzipSha256: string };
export type ObstacleManifest = {
  schemaVersion: 1; dataset: string; zone: "preuseville" | "le-havre" | "grenoble"; version: string;
  identity: { policy: typeof TILE_POLICY; normalizedVersion: string; normalizedManifestSha256: string; [key: string]: unknown };
  sources: ObstacleSourceEdition[]; sourceDates: unknown[]; redistribution: { mode: "LOCAL_PROTOTYPE_ONLY"; publicRedistributionValidated: false; [key: string]: unknown };
  statistics: Record<string, unknown>; artifacts: Record<string, Artifact>;
  coverage: { key: "coverage.geojson"; sha256: string; centre: [number, number]; radiusM: number; meaning: string; outsideTiles: string };
  tiling: { scheme: "XYZ"; format: "GeoJSON, not MVT"; zooms: [9, 12]; emptyTiles: "explicit_files"; policy: typeof TILE_POLICY; tiles: TileEntry[] };
  identityPolicy: string; limitations: string[];
};
export type TileData = Readonly<{ type: "FeatureCollection"; features: TileFeature[] }>;
export const OBSTACLE_SAFETY_WARNING = "Données non exhaustives : une tuile vide ou l’absence de symbole ne garantit jamais l’absence d’obstacles. Vérifier les sources officielles, les obstacles temporaires et les NOTAM.";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new ObstacleTileError("CRYPTO_UNAVAILABLE");
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), b => b.toString(16).padStart(2, "0")).join("");
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(str) && new Set(v).size === v.length;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const nullable = (v: unknown) => v === null || typeof v === "string";
const member = (v: unknown, values: readonly unknown[]) => values.includes(v);
const categories = ["wind_turbine", "mast_antenna", "chimney_flare", "tower_structure", "crane", "particular_obstacle", "aerial_cable", "cable_support"];
const classes = ["points", "groups", "composites", "components", "lines"];
const scopes = ["single_feature", "group", "composite", "component", "unknown"];
const assert = (v: unknown, code: ErrorCode): void => { if (!v) throw new ObstacleTileError(code); };
const safePath = (v: string) => /^[a-zA-Z0-9_./-]+$/.test(v) && !v.startsWith("/") && v.split("/").every(s => s && s !== "." && s !== "..");
function artifact(v: unknown): v is Artifact {
  return obj(v) && integer(v.bytes) && v.bytes > 0 && hash(v.sha256) && member(v.contentType, ["application/json", "application/geo+json"]) &&
    (v.contentEncoding === undefined || v.contentEncoding === "gzip") && (v.decodedSha256 === undefined || hash(v.decodedSha256));
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function counts(v: unknown, allowed: string[], total: number) {
  return obj(v) && Object.entries(v).every(([k, n]) => allowed.includes(k) && integer(n) && n > 0) && Object.values(v).reduce<number>((n, v) => n + Number(v), 0) === total;
}
/** Identity hash checks the generator's identity only. Pin the full manifest digest externally for authentication. */
export async function parseObstacleManifest(bytes: Uint8Array, expectedSha256?: string): Promise<ObstacleManifest> {
  try { return await manifestUnchecked(bytes, expectedSha256); } catch (error) { if (error instanceof ObstacleTileError) throw error; throw new ObstacleTileError("INVALID_MANIFEST"); }
}
async function manifestUnchecked(bytes: Uint8Array, expectedSha256?: string): Promise<ObstacleManifest> {
  if (expectedSha256 !== undefined) {
    assert(hash(expectedSha256), "INVALID_MANIFEST");
    assert(await sha256(bytes) === expectedSha256, "HASH_MISMATCH");
  }
  let v: unknown;
  try { v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ObstacleTileError("INVALID_MANIFEST"); }
  assert(obj(v), "INVALID_MANIFEST"); const m = v as unknown as ObstacleManifest;
  assert(m.schemaVersion === 1 && member(m.zone, ["preuseville", "le-havre", "grenoble"]) && m.dataset === `aeronautical-obstacles-${m.zone}-local-tiles` && hash(m.version), "INVALID_MANIFEST");
  assert(obj(m.identity) && hash(m.identity.normalizedVersion) && hash(m.identity.normalizedManifestSha256), "INVALID_MANIFEST");
  assert(await sha256(new TextEncoder().encode(canonical(m.identity))) === m.version, "HASH_MISMATCH");
  const t = m.tiling, p = t?.policy;
  assert(t?.scheme === "XYZ" && t.format === "GeoJSON, not MVT" && same(t.zooms, [9, 12]) && t.emptyTiles === "explicit_files" &&
    p?.version === "obstacles-local-xyz-v1" && p.overviewZoom === 9 && p.detailZoom === 12 && p.aggregateGridZoom === 11 && p.studyPolygonSteps === 256 && p.coordinates === "EPSG:4326 2D" &&
    [p.geometryClipping, p.points, p.aggregates, p.overview, p.detail].every(str) &&
    p.displayZoomPolicy?.overview.sourceZoom === 9 && p.displayZoomPolicy.overview.displayMaxZoom === 10 && p.displayZoomPolicy.detail.sourceZoom === 12 &&
    p.displayZoomPolicy.detail.displayMinZoom === 11 && p.displayZoomPolicy.detail.overzoom === true && same(p, m.identity.policy), "INVALID_MANIFEST");
  // Exact current 2A policy, including its descriptive wire fields. No Node import at runtime.
  assert(await sha256(new TextEncoder().encode(canonical(p))) === "b70d4d21055ff9e969f5442546c451a507cc1494c8a1284e8850325b0c3fdb7d", "INVALID_MANIFEST");
  assert(obj(m.identity.runtime) && ["node", "v8", "zlib"].every(k => str((m.identity.runtime as Record<string, unknown>)[k])) &&
    obj(m.identity.compression) && m.identity.compression.gzipLevel === 9 && m.identity.compression.gzipHeaderOS === 255 &&
    Array.isArray(m.identity.code) && m.identity.code.length === 5 && m.identity.code.every(c => obj(c) && str(c.file) && hash(c.sha256)), "INVALID_MANIFEST");
  assert(Array.isArray(m.sources) && m.sources.length > 0 && new Set(m.sources.map(s => s.id)).size === m.sources.length && m.sources.every(s => obj(s) && str(s.id) && member(s.source, ["SIA", "OSM", "GEORISQUES"]) && hash(s.sha256) && str(s.artifact) && str(s.attribution) && [s.url, s.referenceDate, s.airacCycle, s.snapshotAtUtc, s.retrievedAtUtc, s.license].every(nullable)), "INVALID_MANIFEST");
  assert(Array.isArray(m.sourceDates) && m.sourceDates.length === m.sources.length && m.sourceDates.every((row, i) => same(row, Object.fromEntries(["id", "referenceDate", "airacCycle", "snapshotAtUtc", "retrievedAtUtc"].map(k => [k, m.sources[i][k as keyof ObstacleSourceEdition]])))), "INVALID_MANIFEST");
  assert(obj(m.redistribution) && m.redistribution.mode === "LOCAL_PROTOTYPE_ONLY" && m.redistribution.publicRedistributionValidated === false && same(m.redistribution, m.identity.redistribution), "INVALID_MANIFEST");
  assert(obj(m.artifacts) && Object.entries(m.artifacts).every(([k, a]) => safePath(k) && artifact(a)), "INVALID_MANIFEST");
  for (const [key, a] of Object.entries(m.artifacts)) if (key.endsWith(".gz")) {
    const raw = m.artifacts[key.slice(0, -3)];
    assert(raw && a.contentEncoding === "gzip" && a.decodedSha256 === raw.sha256 && a.contentType === raw.contentType, "INVALID_MANIFEST");
  }
  assert(m.coverage?.key === "coverage.geojson" && hash(m.coverage.sha256) && m.artifacts[m.coverage.key]?.sha256 === m.coverage.sha256 &&
    Array.isArray(m.coverage.centre) && m.coverage.centre.length === 2 && m.coverage.centre.every(finite) && Math.abs(m.coverage.centre[0]) <= 180 && Math.abs(m.coverage.centre[1]) <= 85.0511287798066 &&
    finite(m.coverage.radiusM) && m.coverage.radiusM > 0 && str(m.coverage.meaning) && str(m.coverage.outsideTiles), "INVALID_MANIFEST");
  for (const key of ["normalized/manifest.json", "normalized/records.json", "normalized/links.json", "normalized/excluded.json", "normalized/outside.json", "normalized/divergences.json", "normalized/statistics.json", "normalized/obstacles.geojson", "redistribution.json", "representations.geojson", "coverage.geojson.gz"]) assert(artifact(m.artifacts[key]), "INVALID_MANIFEST");
  assert(m.artifacts["normalized/manifest.json"].sha256 === m.identity.normalizedManifestSha256 && obj(m.statistics) && m.statistics.physicalObjectCount === null && same(m.statistics.missingObservationIds, []) && str(m.identityPolicy) && Array.isArray(m.limitations) && m.limitations.every(str), "INVALID_MANIFEST");
  assert(Array.isArray(t.tiles) && t.tiles.length > 0 && t.tiles.length <= 100_000 && new Set(t.tiles.map(t => t.key)).size === t.tiles.length, "INVALID_MANIFEST");
  for (const e of t.tiles) {
    assert(obj(e) && member(e.z, [9, 12]) && integer(e.x) && integer(e.y) && e.x < 2 ** e.z && e.y < 2 ** e.z && e.key === `tiles/${e.z}/${e.x}/${e.y}.geojson`, "INVALID_MANIFEST");
    assert(same(e.bbox, tileBounds(e.z, e.x, e.y)) && member(e.coverage, ["study_full", "study_partial", "native_data_extension"]) && integer(e.features) &&
      e.status === (e.features ? "data" : "empty") && counts(e.classes, classes, e.features) && counts(e.categories, categories, e.features), "INVALID_MANIFEST");
    const raw = m.artifacts[e.key], gz = m.artifacts[`${e.key}.gz`];
    assert(artifact(e) && artifact(raw) && artifact(gz) && raw.contentType === "application/geo+json" && raw.contentEncoding === undefined && raw.bytes === e.bytes && raw.sha256 === e.sha256 &&
      e.gzipBytes === gz.bytes && e.gzipSha256 === gz.sha256 && gz.decodedSha256 === e.sha256, "INVALID_MANIFEST");
  }
  assert(Object.keys(m.artifacts).filter(k => /^tiles\//.test(k) && !k.endsWith(".gz")).length === t.tiles.length, "INVALID_MANIFEST");
  const stats = m.statistics;
  for (const key of ["inputObservations", "uniqueObservations", "exactDuplicates", "detailedRepresentations", "confirmedIdentityGroups", "exclusionRecords", "divergences", "tileBytes", "tileGzipBytes", "payloadBytes"]) assert(integer(stats[key]), "INVALID_MANIFEST");
  const counter = (v: unknown, allowed?: string[]) => obj(v) && Object.entries(v).every(([k,n]) => (!allowed || allowed.includes(k)) && integer(n));
  assert(counter(stats.sourceRecords, ["SIA", "OSM", "GEORISQUES"]) && counter(stats.exclusions) && counter(stats.linkDecisions, ["candidate", "ambiguous", "confirmed", "rejected"]) &&
    counts(stats.categories, categories, Number(stats.inputObservations)) && counts(stats.scopes, scopes, Number(stats.inputObservations)) &&
    counts(stats.physicalStatuses, ["existing", "under_construction", "planned", "removed", "unknown"], Number(stats.inputObservations)) &&
    Number(stats.exactDuplicates) === Number(stats.inputObservations) - Number(stats.uniqueObservations) && Number(stats.detailedRepresentations) <= Number(stats.uniqueObservations), "INVALID_MANIFEST");
  assert(m.statistics.payloadBytes === Object.values(m.artifacts).reduce((n, a) => n + a.bytes, 0) &&
    m.statistics.tileBytes === t.tiles.reduce((n, e) => n + e.bytes, 0) && m.statistics.tileGzipBytes === t.tiles.reduce((n, e) => n + e.gzipBytes, 0), "INVALID_MANIFEST");
  for (const z of [9, 12]) {
    const entries = t.tiles.filter(t => t.z === z), stats = (m.statistics.levels as Record<string, Record<string, unknown>>)?.[z];
    assert(entries.length > 0 && obj(stats) && stats.tiles === entries.length && stats.emptyTiles === entries.filter(t => !t.features).length && stats.featureOccurrences === entries.reduce((n, e) => n + e.features, 0) &&
      integer(stats.lineFragments) && integer(stats.aggregates) && stats.uniqueMemberObservations === m.statistics.uniqueObservations, "INVALID_MANIFEST");
  }
  return freeze(m);
}
function measurement(v: unknown): v is ObstacleMeasurement {
  return obj(v) && (v.originalValue === null || typeof v.originalValue === "string" || finite(v.originalValue)) && nullable(v.originalUnit) &&
    member(v.unit, ["m", "ft", null]) && (v.valueM === null || finite(v.valueM)) && member(v.reference, ["AGL", "AMSL", "ROOF", "SUPPORT", "UNKNOWN"]) && nullable(v.datum) && nullable(v.definition) && typeof v.sourceField === "string" &&
    (v.accuracyM === null || finite(v.accuracyM)) && member(v.unknownReason, ["missing", "invalid_value", "unknown_unit", null]);
}
function observation(v: unknown, editions: Set<string>): v is Omit<AeronauticalObstacleRecord, "geometry" | "original"> {
  if (!obj(v)) return false;
  return str(v.id) && str(v.observationId) && str(v.sourceId) && nullable(v.sourceVersion) && member(v.source, ["SIA", "OSM", "GEORISQUES"]) &&
    strings(v.sourceEditionIds) && v.sourceEditionIds.length > 0 && v.sourceEditionIds.every(id => editions.has(id)) && member(v.category, categories) && nullable(v.sourceType) && nullable(v.name) &&
    member(v.geometryRole, ["source_position", "representative_point", "group_point", "source_trace"]) && member(v.recordScope, scopes) && nullable(v.horizontalDatum) &&
    (v.horizontalAccuracyM === null || finite(v.horizontalAccuracyM)) && (v.declaredCount === null || integer(v.declaredCount)) && nullable(v.siteId) &&
    member(v.physicalStatus, ["existing", "under_construction", "planned", "removed", "unknown"]) && member(v.administrativeStatus, ["authorized", "under_review", "refused", "unknown"]) &&
    member(v.operationStatus, ["operating", "disused", "unknown"]) && Array.isArray(v.statusEvidence) && v.statusEvidence.every(str) && member(v.permanence, ["permanent", "temporary", "unknown"]) && member(v.mobility, ["fixed", "mobile", "unknown"]) &&
    obj(v.dates) && ["effectiveDate", "editedAtRaw", "editedAtUtc", "validFrom", "validUntil"].every(k => nullable((v.dates as Record<string, unknown>)[k])) &&
    obj(v.measurements) && ["heightAgl", "topAmsl", "declaredHeight"].every(k => measurement((v.measurements as Record<string, unknown>)[k])) && Array.isArray(v.measurements.additional) && v.measurements.additional.every(measurement) &&
    member(v.verticalProfile, ["known", "unknown", "not_applicable"]) && obj(v.lineage) && v.lineage.independence === "not_established" && Array.isArray(v.lineage.citedSources) && v.lineage.citedSources.every(str) &&
    Array.isArray(v.issues) && v.issues.every(i => obj(i) && str(i.code) && str(i.detail)) && !("geometry" in v) && !("original" in v);
}
export async function parseObstacleTile(bytes: Uint8Array, entry: TileEntry, manifest: ObstacleManifest): Promise<TileData> {
  try { return await tileUnchecked(bytes, entry, manifest); } catch (error) { if (error instanceof ObstacleTileError) throw error; throw new ObstacleTileError("INVALID_GEOJSON"); }
}
async function tileUnchecked(bytes: Uint8Array, entry: TileEntry, manifest: ObstacleManifest): Promise<TileData> {
  assert(bytes.byteLength === entry.bytes && await sha256(bytes) === entry.sha256, "HASH_MISMATCH");
  let v: unknown;
  try { v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ObstacleTileError("INVALID_GEOJSON"); }
  assert(obj(v) && v.type === "FeatureCollection" && Array.isArray(v.features), "INVALID_GEOJSON");
  const data = v as unknown as TileData;
  assert(data.features.length === entry.features, "INVALID_GEOJSON");
  const editions = new Set(manifest.sources.map(s => s.id)), ids = new Set<string>();
  const point = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every(finite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85.0511287798066 &&
    p[0] >= entry.bbox[0] - 1e-10 && p[0] <= entry.bbox[2] + 1e-10 && p[1] >= entry.bbox[1] - 1e-10 && p[1] <= entry.bbox[3] + 1e-10;
  const line = (p: unknown): boolean => Array.isArray(p) && p.length >= 2 && p.every(point) && p.some(q => !same(q, p[0]));
  for (const f of data.features) {
    assert(obj(f) && f.type === "Feature" && str(f.id) && !ids.has(f.id), "INVALID_GEOJSON"); ids.add(f.id);
    const g = f.geometry, p = f.properties;
    assert(obj(g) && (g.type === "Point" ? point(g.coordinates) : g.type === "LineString" ? line(g.coordinates) : g.type === "MultiLineString" && Array.isArray(g.coordinates) && g.coordinates.length > 0 && g.coordinates.every(line)), "INVALID_GEOJSON");
    assert(obj(p) && str(p.representationId) && member(p.representation, ["source_record", "confirmed_identity", "cartographic_aggregate"]) && member(p.featureClass, classes) && member(p.category, categories) && member(p.recordScope, scopes) &&
      strings(p.memberObservationIds) && strings(p.memberRecordIds) && strings(p.sourceEditionIds) && strings(p.linkIds) && integer(p.sourceRecordCount) && p.sourceRecordCount > 0 && p.physicalObjectCount === null &&
      Array.isArray(p.observations) && p.observations.length === p.sourceRecordCount && p.observations.every(o => observation(o, editions)), "INVALID_GEOJSON");
    const equalSet = (a: string[], b: string[]) => same([...a].sort(), [...new Set(b)].sort());
    assert(equalSet(p.memberObservationIds, p.observations.map(o => o.observationId)) && p.memberObservationIds.length === p.sourceRecordCount && equalSet(p.memberRecordIds, p.observations.map(o => o.id)) &&
      equalSet(p.sourceEditionIds, p.observations.flatMap(o => o.sourceEditionIds)) && p.unknownAglCount === p.observations.filter(o => o.measurements.heightAgl.valueM === null).length &&
      p.unknownDeclaredHeightCount === p.observations.filter(o => o.measurements.declaredHeight.valueM === null).length && p.observations.every(o => o.category === p.category && o.recordScope === p.recordScope), "INVALID_GEOJSON");
    if (p.representation === "source_record") assert(p.observations.length === 1 && p.representationId === p.observations[0].observationId, "INVALID_GEOJSON");
    else if (p.representation === "confirmed_identity") assert(p.observations.length > 1 && p.representationId === `identity:${await sha256(new TextEncoder().encode(canonical(p.observations.map(o => o.id).sort())))}`, "INVALID_GEOJSON");
    else assert(/^aggregate:[a-f0-9]{64}$/.test(p.representationId) && p.observations.length > 1, "INVALID_GEOJSON");
    assert(p.observations.every(o => o.id === `${o.source}:${encodeURIComponent(o.sourceId)}` && o.observationId.startsWith(`${o.id}@`) && hash(o.observationId.slice(o.id.length + 1)) &&
      o.sourceEditionIds.every(id => manifest.sources.some(s => s.id === id && s.source === o.source))), "INVALID_GEOJSON");
    if (g.type === "Point") assert(p.featureClass === (p.recordScope === "group" ? "groups" : p.recordScope === "composite" ? "composites" : p.recordScope === "component" ? "components" : "points") &&
      (p.representation === "cartographic_aggregate" || p.observations.some(o => o.geometryRole === p.geometryRole)), "INVALID_GEOJSON");
    assert(p.representation === "cartographic_aggregate" || p.observations.some(o => o.geometryRole === p.geometryRole), "INVALID_GEOJSON");
    assert(p.observations.every(o => o.measurements.heightAgl.reference === "AGL" && o.measurements.topAmsl.reference === "AMSL"), "INVALID_GEOJSON");
    assert((g.type !== "Point") === (p.featureClass === "lines") && (p.representation !== "cartographic_aggregate" || entry.z === 9 && g.type === "Point" && p.geometryRole === "cartographic_anchor_not_obstacle_position"), "INVALID_GEOJSON");
    if (g.type === "Point") assert(same(tileXY(...g.coordinates as [number, number], entry.z), [entry.x, entry.y]) && p.fragmentOf === undefined && f.id === p.representationId, "INVALID_GEOJSON");
    else assert(p.fragmentOf === p.representationId && f.id === `${p.representationId}/fragment/${entry.z}/${entry.x}/${entry.y}/${(await sha256(new TextEncoder().encode(canonical(g)))).slice(0, 16)}`, "INVALID_GEOJSON");
  }
  const tally = (key: "featureClass" | "category") => data.features.reduce<Record<string, number>>((r, f) => { const k = f.properties[key]; r[k] = (r[k] ?? 0) + 1; return r; }, {});
  assert(same(tally("featureClass"), entry.classes) && same(tally("category"), entry.categories), "INVALID_GEOJSON");
  return freeze(data);
}
