import type { AeronauticalObstacleRecord, ObstacleRecordLink, ObstacleGeometry } from "../../app/lib/aeronauticalObstacles.ts";
import { canonical, sha256 } from "./normalize.ts";
import { tileXY, tileBounds, boundsRing, circleRing, cellsForBounds, geometryBounds, polygonTileIntersection, clipLineToTile } from "./tileGeometry.ts";
import type { Position } from "./tileGeometry.ts";

export const TILE_POLICY = {
  version: "obstacles-local-xyz-v1", overviewZoom: 9, detailZoom: 12, aggregateGridZoom: 11,
  displayZoomPolicy: { overview: { sourceZoom: 9, displayMaxZoom: 10 }, detail: { sourceZoom: 12, displayMinZoom: 11, overzoom: true } },
  studyPolygonSteps: 256, coordinates: "EPSG:4326 2D", geometryClipping: "lon/lat segment-rectangle, no simplification",
  points: "single half-open owner: east/south at a boundary; no buffer",
  aggregates: "cartographic source-record groups, never physical obstacle counts; anchor is a native member point",
  overview: "All point observations remain referenced; all native lines retained. No height threshold.",
  detail: "All observations referenced individually or through explicitly confirmed identity only; overzoom above 12",
} as const;

export interface TileRepresentation {
  id: string;
  geometry: ObstacleGeometry;
  records: AeronauticalObstacleRecord[];
  primary: AeronauticalObstacleRecord;
}
export interface TileFeature extends GeoJSON.Feature<ObstacleGeometry> {
  id: string;
  properties: {
    representationId: string;
    representation: "source_record" | "confirmed_identity" | "cartographic_aggregate";
    featureClass: "points" | "groups" | "composites" | "components" | "lines";
    category: string;
    recordScope: string;
    geometryRole: string;
    memberObservationIds: string[];
    memberRecordIds: string[];
    sourceEditionIds: string[];
    linkIds: string[];
    sourceRecordCount: number;
    physicalObjectCount: null;
    unknownAglCount: number;
    unknownDeclaredHeightCount: number;
    observations: Omit<AeronauticalObstacleRecord, "geometry" | "original">[];
    fragmentOf?: string;
  };
}
export interface ObstacleTile {
  z: number; x: number; y: number; key: string;
  coverage: "study_full" | "study_partial" | "native_data_extension";
  features: TileFeature[];
}
function fail(condition: unknown, error: string): asserts condition { if (!condition) throw new Error(error); }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function validateRecord(r: AeronauticalObstacleRecord) {
  fail(r && typeof r.id === "string" && r.id.length && typeof r.observationId === "string" && r.observationId.length && r.measurements && r.original && Array.isArray(r.sourceEditionIds), "INVALID_NORMALIZED_RECORD");
  const point = (p: number[]) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 85.0511287798066;
  const line = (p: number[][]) => Array.isArray(p) && p.length >= 2 && p.every(point) && p.some(v => v[0] !== p[0][0] || v[1] !== p[0][1]);
  fail(r.geometry && (r.geometry.type === "Point" ? point(r.geometry.coordinates) : r.geometry.type === "LineString" ? line(r.geometry.coordinates) :
    r.geometry.type === "MultiLineString" && r.geometry.coordinates.length && r.geometry.coordinates.every(line)), "INVALID_OR_NON_2D_GEOMETRY");
}

/** Display identity only: records/measurements remain separate and immutable. */
export function representations(records: AeronauticalObstacleRecord[], links: ObstacleRecordLink[]) {
  const observations = new Map<string, AeronauticalObstacleRecord>();
  let exactDuplicates = 0;
  for (const record of records) {
    validateRecord(record);
    const old = observations.get(record.observationId);
    if (old) { fail(canonical(old) === canonical(record), "CONFLICTING_OBSERVATION_ID"); exactDuplicates++; }
    else observations.set(record.observationId, record);
  }
  const rows = [...observations.values()].sort((a, b) => compare(a.observationId, b.observationId));
  const parent = new Map(rows.map(r => [r.observationId, r.observationId]));
  const find = (id: string): string => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p); parent.set(id, root); return root;
  };
  for (const link of links) {
    fail(observations.has(link.fromObservationId) && observations.has(link.toObservationId), "DANGLING_OBSTACLE_LINK");
    if (link.decision !== "confirmed" || link.relation !== "possible_same_object") continue;
    const a = observations.get(link.fromObservationId)!, b = observations.get(link.toObservationId)!;
    fail(link.evidence.length && link.method && a.recordScope === "single_feature" && b.recordScope === "single_feature" && a.category === b.category,
      "CONFIRMED_IDENTITY_REQUIRES_REVIEW");
    fail((a.geometry.type === "Point" && b.geometry.type === "Point") || canonical(a.geometry) === canonical(b.geometry), "CONFIRMED_GEOMETRY_REQUIRES_REVIEW");
    const roots = [find(a.observationId), find(b.observationId)].sort(); parent.set(roots[1], roots[0]);
  }
  const groups = new Map<string, AeronauticalObstacleRecord[]>();
  for (const r of rows) { const root = find(r.observationId); groups.set(root, [...groups.get(root) ?? [], r]); }
  const priority = (r: AeronauticalObstacleRecord) => r.source === "SIA" ? 0 : r.source === "GEORISQUES" ? 1 : 2;
  const features: TileRepresentation[] = [...groups.values()].map(group => {
    const primary = [...group].sort((a, b) => priority(a) - priority(b) || compare(a.observationId, b.observationId))[0];
    return { id: group.length === 1 ? primary.observationId : `identity:${sha256(canonical(group.map(r => r.id).sort()))}`,
      geometry: primary.geometry, records: group, primary };
  }).sort((a, b) => compare(a.id, b.id));
  fail(new Set(features.map(f => f.id)).size === features.length, "DUPLICATE_REPRESENTATION_ID");
  return { representations: features, exactDuplicates, uniqueObservations: rows.length };
}
function asFeature(reps: TileRepresentation[], links: ObstacleRecordLink[], aggregate = false): TileFeature {
  const first = reps[0], r = first.primary;
  const rows = reps.flatMap(rep => rep.records).sort((a, b) => compare(a.observationId, b.observationId));
  const ids = rows.map(row => row.observationId), members = new Set(ids);
  const featureClass = first.geometry.type !== "Point" ? "lines" : r.recordScope === "group" ? "groups" :
    r.recordScope === "composite" ? "composites" : r.recordScope === "component" ? "components" : "points";
  const id = aggregate ? `aggregate:${sha256(canonical(reps.map(rep => rep.id).sort()))}` : first.id;
  return { type: "Feature", id, geometry: first.geometry, properties: {
    representationId: id, representation: aggregate ? "cartographic_aggregate" : rows.length > 1 ? "confirmed_identity" : "source_record",
    featureClass, category: r.category, recordScope: r.recordScope,
    geometryRole: aggregate ? "cartographic_anchor_not_obstacle_position" : r.geometryRole,
    memberObservationIds: ids, memberRecordIds: [...new Set(rows.map(row => row.id))].sort(),
    sourceEditionIds: [...new Set(rows.flatMap(row => row.sourceEditionIds))].sort(),
    linkIds: links.filter(l => members.has(l.fromObservationId) || members.has(l.toObservationId)).map(l => l.id).sort(),
    sourceRecordCount: ids.length, physicalObjectCount: null,
    unknownAglCount: rows.filter(row => row.measurements.heightAgl.valueM === null).length,
    unknownDeclaredHeightCount: rows.filter(row => row.measurements.declaredHeight.valueM === null).length,
    observations: rows.map(({ geometry: _geometry, original: _original, ...observation }) => observation),
  } };
}
export function levelFeatures(reps: TileRepresentation[], links: ObstacleRecordLink[], overview: boolean): TileFeature[] {
  if (!overview) return reps.map(rep => asFeature([rep], links));
  const buckets = new Map<string, TileRepresentation[]>(), lines: TileFeature[] = [];
  for (const rep of reps) {
    if (rep.geometry.type !== "Point") { lines.push(asFeature([rep], links)); continue; }
    const [x, y] = tileXY(rep.geometry.coordinates[0], rep.geometry.coordinates[1], TILE_POLICY.aggregateGridZoom);
    const key = canonical([x, y, rep.primary.category, rep.primary.recordScope, rep.primary.physicalStatus]);
    buckets.set(key, [...buckets.get(key) ?? [], rep]);
  }
  return [...lines, ...[...buckets.values()].map(bucket => asFeature(bucket, links, bucket.length > 1))].sort((a, b) => compare(a.id, b.id));
}

export function makeTiles(records: AeronauticalObstacleRecord[], links: ObstacleRecordLink[], centre: Position, radiusM: number) {
  tileXY(...centre, TILE_POLICY.detailZoom);
  const ring = circleRing(centre, radiusM, TILE_POLICY.studyPolygonSteps);
  const index = representations(records, links), tiles: ObstacleTile[] = [];
  for (const z of [TILE_POLICY.overviewZoom, TILE_POLICY.detailZoom]) {
    const cells = new Map<string, ObstacleTile>();
    const ensure = (x: number, y: number) => {
      const key = `${x}/${y}`;
      let tile = cells.get(key);
      if (!tile) {
        const bounds = tileBounds(z, x, y), clipped = polygonTileIntersection(ring, bounds);
        const full = boundsRing(bounds).slice(0, 4).every(corner => clipped.some(p => p[0] === corner[0] && p[1] === corner[1]));
        tile = { z, x, y, key: `tiles/${z}/${x}/${y}.geojson`, coverage: full ? "study_full" : clipped.length ? "study_partial" : "native_data_extension", features: [] };
        cells.set(key, tile);
      }
      return tile;
    };
    for (const [x, y] of cellsForBounds(geometryBounds(ring), z)) {
      if (polygonTileIntersection(ring, tileBounds(z, x, y)).length) ensure(x, y);
    }
    for (const feature of levelFeatures(index.representations, links, z === TILE_POLICY.overviewZoom)) {
      if (feature.geometry.type === "Point") {
        const [x, y] = tileXY(feature.geometry.coordinates[0], feature.geometry.coordinates[1], z);
        ensure(x, y).features.push(feature); continue;
      }
      const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const [x, y] of cellsForBounds(geometryBounds(lines.flat()), z)) {
        const parts = clipLineToTile(lines, z, x, y);
        if (!parts.length) continue;
        const geometry: ObstacleGeometry = parts.length === 1 ? { type: "LineString", coordinates: parts[0] } : { type: "MultiLineString", coordinates: parts };
        const id = `${feature.id}/fragment/${z}/${x}/${y}/${sha256(canonical(geometry)).slice(0, 16)}`;
        ensure(x, y).features.push({ ...feature, id, geometry, properties: { ...feature.properties, fragmentOf: feature.id } });
      }
    }
    const represented = new Set([...cells.values()].flatMap(t => t.features.flatMap(f => f.properties.memberObservationIds)));
    fail(represented.size === index.uniqueObservations && records.every(r => represented.has(r.observationId)), "OBSERVATION_LOST_DURING_TILING");
    tiles.push(...[...cells.values()].sort((a, b) => a.x - b.x || a.y - b.y).map(t => ({ ...t, features: t.features.sort((a, b) => compare(a.id, b.id)) })));
  }
  return { tiles, studyRing: ring, index, nativeFeatures: index.representations.map(rep => asFeature([rep], links)) };
}
