#!/usr/bin/env python3
"""Offline OSM PBF -> clipped, attributed GeoJSON + local XYZ GeoJSON tiles. No network."""
import argparse
import collections
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import time

import osmium

CENTER = (3.07556, 50.68722)  # LFQO, DGAC/STAC PIAF; lon, lat
CENTER_SOURCE = 'https://piaf.stac.aviation-civile.gouv.fr/airports/table'
MIN_VOLTAGE_V = 63_000
RADIUS_M = 20_000
EARTH_M = 6_371_008.8
SOURCES = {
    'nord-pas-de-calais': 'https://download.geofabrik.de/europe/france/nord-pas-de-calais-latest.osm.pbf',
    'belgium': 'https://download.geofabrik.de/europe/belgium-latest.osm.pbf',
}


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def voltage_values(raw):
    """OSM voltage values are positive integers in volts, optionally separated by semicolons."""
    if not isinstance(raw, str):
        return None
    parts = [part.strip() for part in raw.split(';')]
    if not parts or any(not re.fullmatch(r'[0-9]+', part) or int(part) <= 0 for part in parts):
        return None
    return [int(part) for part in parts]


def qualifying_voltages(tags):
    if tags.get('power') != 'line':
        return None
    # power=line implies overhead in OSM; explicit contradictory locations are rejected.
    if tags.get('location', '').strip().lower() not in ('', 'overhead'):
        return None
    if any(tags.get(key, 'no').strip().lower() not in ('', 'no', 'false', '0') for key in ('tunnel', 'underground', 'submarine')):
        return None
    values = voltage_values(tags.get('voltage'))
    return values if values and max(values) >= MIN_VOLTAGE_V else None


def project(point, inverse=False):
    """Spherical azimuthal equidistant centred at LFQO; radial distances in metres."""
    lon0, lat0 = map(math.radians, CENTER)
    if inverse:
        x, y = point
        rho = math.hypot(x, y)
        if rho < 1e-10:
            return list(CENTER)
        c = rho / EARTH_M
        lat = math.asin(math.cos(c)*math.sin(lat0) + y*math.sin(c)*math.cos(lat0)/rho)
        lon = lon0 + math.atan2(x*math.sin(c), rho*math.cos(lat0)*math.cos(c)-y*math.sin(lat0)*math.sin(c))
        return [math.degrees(lon), math.degrees(lat)]
    lon, lat = map(math.radians, point)
    cosine = math.sin(lat0)*math.sin(lat) + math.cos(lat0)*math.cos(lat)*math.cos(lon-lon0)
    c = math.acos(max(-1, min(1, cosine)))
    k = c/math.sin(c) if c > 1e-10 else 1
    return [EARTH_M*k*math.cos(lat)*math.sin(lon-lon0),
            EARTH_M*k*(math.cos(lat0)*math.sin(lat)-math.sin(lat0)*math.cos(lat)*math.cos(lon-lon0))]


def circle_segment(a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    aa = dx*dx + dy*dy
    if aa < 1e-16:
        return None
    bb = 2*(a[0]*dx + a[1]*dy)
    cc = a[0]*a[0] + a[1]*a[1] - RADIUS_M**2
    disc = bb*bb - 4*aa*cc
    if disc <= 0:
        return None
    lo, hi = max(0, (-bb-math.sqrt(disc))/(2*aa)), min(1, (-bb+math.sqrt(disc))/(2*aa))
    return ([a[0]+lo*dx, a[1]+lo*dy], [a[0]+hi*dx, a[1]+hi*dy]) if hi-lo > 1e-12 else None


def rectangle_segment(a, b, bounds):
    west, south, east, north = bounds
    dx, dy = b[0]-a[0], b[1]-a[1]
    lo, hi = 0., 1.
    for p, q in [(-dx, a[0]-west), (dx, east-a[0]), (-dy, a[1]-south), (dy, north-a[1])]:
        if abs(p) < 1e-16:
            if q < 0:
                return None
        elif p < 0:
            lo = max(lo, q/p)
        else:
            hi = min(hi, q/p)
        if lo > hi:
            return None
    if math.hypot(dx, dy)*(hi-lo) < 1e-12:
        return None
    return [a[0]+lo*dx, a[1]+lo*dy], [a[0]+hi*dx, a[1]+hi*dy]


def clip_parts(parts, segment_clipper):
    result = []
    for points in parts:
        current = []
        for a, b in zip(points, points[1:]):
            clipped = segment_clipper(a, b)
            if not clipped:
                if current:
                    result.append(current)
                    current = []
                continue
            start, end = clipped
            if current and math.dist(current[-1], start) < 1e-8:
                current.append(end)
            else:
                if current:
                    result.append(current)
                current = [start, end]
        if current:
            result.append(current)
    return result


def geometry(parts):
    rounded = [[[round(x, 8), round(y, 8)] for x, y in points] for points in parts]
    return {'type': 'LineString', 'coordinates': rounded[0]} if len(rounded) == 1 else {'type': 'MultiLineString', 'coordinates': rounded}


def parts_of(geom):
    return [geom['coordinates']] if geom['type'] == 'LineString' else geom['coordinates']


def source_metadata(path, source_id):
    with osmium.io.Reader(str(path)) as reader:
        header = reader.header()
        snapshot = header.get('osmosis_replication_timestamp') or None
        generator = header.get('generator') or None
    sha = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            sha.update(block)
    headers = path.parent / (source_id + '.headers')
    text = headers.read_text() if headers.exists() else ''
    last_modified = re.findall(r'^last-modified:\s*(.+)', text, re.I | re.M)
    response_date = re.findall(r'^date:\s*(.+)', text, re.I | re.M)
    return {'id': source_id, 'url': SOURCES.get(source_id), 'input_file': path.name,
            'bytes': path.stat().st_size, 'sha256': sha.hexdigest(), 'snapshot_at_utc': snapshot,
            'http_last_modified': last_modified[-1].strip() if last_modified else None,
            'http_response_date': response_date[-1].strip() if response_date else None,
            'local_file_mtime_utc': dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).isoformat().replace('+00:00', 'Z'),
            'generator': generator}


def collect(inputs):
    chosen = {}
    stats = collections.Counter()
    sources = []
    for source_id, path in inputs:
        print('Reading ' + str(path), flush=True)
        metadata = source_metadata(path, source_id)
        sources.append(metadata)
        processor = osmium.FileProcessor(str(path)).with_locations('flex_mem').with_filter(
            osmium.filter.TagFilter(('power', 'line')))
        for way in processor:
            if not way.is_way():
                continue
            stats['filtered_ways_scanned'] += 1
            tags = dict(way.tags)
            voltages = qualifying_voltages(tags)
            if voltages is None:
                stats['excluded_by_aerial_voltage_filter'] += 1
                continue
            if len(way.nodes) < 2 or any(not node.location.valid() for node in way.nodes):
                stats['invalid_or_missing_geometry_ways'] += 1
                continue
            coords = [[node.lon, node.lat] for node in way.nodes]
            # Cheap broad rejection before projecting; includes segments crossing the circle.
            if max(p[0] for p in coords) < CENTER[0]-.3 or min(p[0] for p in coords) > CENTER[0]+.3 or max(p[1] for p in coords) < CENTER[1]-.19 or min(p[1] for p in coords) > CENTER[1]+.19:
                continue
            clipped = clip_parts([[project(p) for p in coords]], circle_segment)
            if not clipped:
                continue
            parts = [[project(p, inverse=True) for p in points] for points in clipped]
            timestamp = way.timestamp.isoformat().replace('+00:00', 'Z') if way.timestamp.timestamp() > 0 else None
            props = {'osm_id': way.id, 'osm_type': 'way', 'osm_version': way.version or None,
                     'osm_timestamp_utc': timestamp, 'power': tags['power'], 'voltage': tags.get('voltage'),
                     'voltage_v': voltages[0] if len(voltages) == 1 else None,
                     'voltage_max_v': max(voltages), 'location': tags.get('location'),
                     'aerial_basis': 'explicit location=overhead' if tags.get('location') else 'power=line implies overhead (OSM)',
                     'name': tags.get('name'), 'operator': tags.get('operator'), 'osm_source_tag': tags.get('source'),
                     'selected_extract': source_id, 'snapshot_at_utc': metadata['snapshot_at_utc'],
                     'source_extracts': source_id, 'attribution': '© OpenStreetMap contributors; Geofabrik', 'license': 'ODbL-1.0'}
            feature = {'type': 'Feature', 'id': 'way/' + str(way.id), 'properties': props, 'geometry': geometry(parts)}
            previous = chosen.get(way.id)
            if previous:
                stats['duplicate_ways_merged'] += 1
                known = set(previous['properties']['source_extracts'].split(';')) | {source_id}
                rank = lambda f: (f['properties']['osm_version'] or 0, f['properties']['snapshot_at_utc'] or '')
                if rank(feature) > rank(previous):
                    chosen[way.id] = feature
                chosen[way.id]['properties']['source_extracts'] = ';'.join(sorted(known))
            else:
                chosen[way.id] = feature
        del processor
    return [chosen[key] for key in sorted(chosen)], sources, dict(stats)


def tile_bounds(z, x, y):
    n = 2**z
    lat = lambda row: math.degrees(math.atan(math.sinh(math.pi*(1-2*row/n))))
    return [x/n*360-180, lat(y+1), (x+1)/n*360-180, lat(y)]


def tile_xy(lon, lat, z):
    n = 2**z
    return (int((lon+180)/360*n), int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n))


def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)+'\n').encode()


def write_outputs(features, sources, stats, output, zoom=11):
    output.mkdir(parents=True, exist_ok=True)
    collection = {'type': 'FeatureCollection', 'features': features}
    raw = encode(collection)
    (output/'lfqo-power.geojson').write_bytes(raw)
    (output/'lfqo-power.geojson.gz').write_bytes(gzip.compress(raw, mtime=0))
    tiles = collections.defaultdict(list)
    for feature in features:
        parts = parts_of(feature['geometry'])
        coords = [p for line in parts for p in line]
        xmin, ymax = tile_xy(min(p[0] for p in coords), min(p[1] for p in coords), zoom)
        xmax, ymin = tile_xy(max(p[0] for p in coords), max(p[1] for p in coords), zoom)
        for x in range(xmin, xmax+1):
            for y in range(ymin, ymax+1):
                clipped = clip_parts(parts, lambda a, b: rectangle_segment(a, b, tile_bounds(zoom, x, y)))
                if clipped:
                    tiles[(x,y)].append({**feature, 'geometry': geometry(clipped)})
    tile_manifest = []
    for (x,y), tile_features in sorted(tiles.items()):
        key = 'tiles/{}/{}/{}.geojson'.format(zoom,x,y)
        path = output/key
        path.parent.mkdir(parents=True, exist_ok=True)
        data = encode({'type':'FeatureCollection','features':tile_features})
        path.write_bytes(data)
        path.with_suffix('.geojson.gz').write_bytes(gzip.compress(data, mtime=0))
        tile_manifest.append({'key':key,'bbox':tile_bounds(zoom,x,y),'features':len(tile_features),'bytes':len(data),'gzip_bytes':path.with_suffix('.geojson.gz').stat().st_size,'sha256':hashlib.sha256(data).hexdigest()})
    stats.update({'features':len(features), 'by_power':dict(collections.Counter(f['properties']['power'] for f in features)),
                  'missing_voltage':sum(f['properties']['voltage'] is None for f in features),
                  'geojson_bytes':len(raw),'geojson_gzip_bytes':(output/'lfqo-power.geojson.gz').stat().st_size,
                  'tiles':len(tile_manifest),'tiles_bytes':sum(t['bytes'] for t in tile_manifest),'tiles_gzip_bytes':sum(t['gzip_bytes'] for t in tile_manifest)})
    manifest = {'schema_version':1,'generated_at_utc':utc_now(),'center':{'icao':'LFQO','longitude':CENTER[0],'latitude':CENTER[1],'source':CENTER_SOURCE},
                'radius_m':RADIUS_M,'clip_method':'spherical azimuthal equidistant, analytic segment/circle intersection; straight projected segments',
                'crs':'EPSG:4326; GeoJSON longitude,latitude','source':'OpenStreetMap via Geofabrik downloadable PBF; no Overpass',
                'sources':sources,'statistics':stats,'attribution':'© OpenStreetMap contributors; extracts by Geofabrik',
                'license':'https://opendatacommons.org/licenses/odbl/1-0/', 'coverage':'France + Belgium; OSM mapped ways only, NOT exhaustive obstacle coverage',
                'filter':{'power':'line','min_voltage_v':MIN_VOLTAGE_V,'multiple_values':'keep if at least one known value is >= 63000 V; require all semicolon-separated components to be positive integer volts',
                          'aerial':'power=line implies overhead; exclude explicit non-overhead location, tunnel, underground or submarine',
                          'unknown_voltage':'excluded; no inferred voltage'},
                'voltage_policy':'Original voltage tag unchanged; voltage_max_v is the largest parsed component; voltage_v only for a single integer in volts',
                'tiling':{'scheme':'XYZ','zoom':zoom,'format':'GeoJSON, NOT MVT','tile_bbox_crs':'EPSG:4326','buffer':0,'tiles':tile_manifest},
                'dataset_sha256':hashlib.sha256(raw).hexdigest()}
    (output/'manifest.json').write_bytes(encode(manifest))
    print(json.dumps(stats, ensure_ascii=False), flush=True)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New version directory; existing output is refused')
    parser.add_argument('--zoom', type=int, default=11, choices=range(8,15))
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output directory to preserve previous snapshots and avoid obsolete tiles')
    start = time.monotonic()
    features, sources, stats = collect([(key, args.input_dir/(key+'.osm.pbf')) for key in SOURCES])
    stats['processing_seconds'] = round(time.monotonic()-start,2)
    write_outputs(features,sources,stats,args.output,args.zoom)


if __name__ == '__main__':
    main()
