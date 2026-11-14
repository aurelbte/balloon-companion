#!/usr/bin/env python3
"""Offline per-country extension of the LFQO generator. Never downloads, publishes or uploads."""
import argparse
import collections
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

import osmium
from shapely.geometry import LineString, Polygon, MultiPolygon, box, mapping
from shapely.prepared import prep

import build as lfqo

HERE = Path(__file__).resolve().parent
COUNTRIES = json.loads((HERE/'countries.json').read_text())


def read_poly(path):
    """Geofabrik .poly: multiple exterior rings and !-prefixed holes; reject malformed coverage."""
    lines = [s.strip() for s in Path(path).read_text().splitlines() if s.strip()]
    if len(lines) < 4:
        raise ValueError('Missing Geofabrik polygon')
    shells, holes, i, finished = [], [], 1, False
    while i < len(lines):
        name = lines[i]
        i += 1
        if name == 'END':
            finished = True
            break
        ring = []
        while i < len(lines) and lines[i] != 'END':
            lon, lat = map(float, lines[i].split())
            if not (-180 <= lon <= 180 and -85.05112878 <= lat <= 85.05112878):
                raise ValueError('Polygon outside supported XYZ extent')
            ring.append((lon,lat))
            i += 1
        if i >= len(lines) or len(ring) < 3:
            raise ValueError('Unclosed/invalid polygon ring')
        i += 1
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        (holes if name.startswith('!') else shells).append(ring)
    if not finished or i != len(lines) or not shells:
        raise ValueError('Incomplete polygon file')
    attached = [[] for _ in shells]
    for hole in holes:
        candidates = [i for i,shell in enumerate(shells) if Polygon(shell).covers(Polygon(hole))]
        if not candidates:
            raise ValueError('Hole without containing exterior ring')
        owner = min(candidates,key=lambda i:Polygon(shells[i]).area)
        attached[owner].append(hole)
    result = MultiPolygon([Polygon(shell,attached[i]) for i,shell in enumerate(shells)])
    if result.is_empty or not result.is_valid:
        raise ValueError('Invalid Geofabrik polygon; no silent geometry repair')
    return result


def line_parts(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == 'LineString':
        points = [[round(x,8),round(y,8)] for x,y in geom.coords]
        points = [p for i,p in enumerate(points) if i == 0 or p != points[i-1]]
        return [points] if len(points) >= 2 else []
    if hasattr(geom,'geoms'):
        return [part for child in geom.geoms for part in line_parts(child)]
    return []  # Isolated boundary points are not lines.


def collect_country(inputs, source_urls, coverage, location_index='flex_mem'):
    """Resolve observed OSM versions BEFORE filtering, so newer rejected ways cannot revive older ones."""
    records, sources, stats = {}, [], collections.Counter()
    prepared = prep(coverage)
    for source_id,path in sorted(inputs):
        print('Reading '+str(path),flush=True)
        metadata = lfqo.source_metadata(path,source_id)
        metadata['url'] = source_urls[source_id]
        sources.append(metadata)
        processor = osmium.FileProcessor(str(path)).with_locations(location_index).with_filter(osmium.filter.KeyFilter('power'))
        for way in processor:
            if not way.is_way():
                continue
            stats['power_ways_scanned'] += 1
            stamp = way.timestamp.isoformat().replace('+00:00','Z') if way.timestamp.timestamp() > 0 else None
            rank = (way.version or 0,stamp or '',metadata['snapshot_at_utc'] or '',source_id)
            previous = records.get(way.id)
            seen = set(previous['sources']) | {source_id} if previous else {source_id}
            if previous:
                stats['duplicate_way_observations'] += 1
                if rank <= previous['rank']:
                    previous['sources'] = seen
                    continue
            record = {'rank':rank,'sources':seen,'feature':None}
            records[way.id] = record
            tags = dict(way.tags)
            voltages = lfqo.qualifying_voltages(tags)
            if voltages is None:
                stats['rejected_by_existing_filter'] += 1
                continue
            if len(way.nodes) < 2 or any(not n.location.valid() for n in way.nodes):
                stats['invalid_or_missing_geometry_ways'] += 1
                continue
            coords = [[n.lon,n.lat] for n in way.nodes]
            line = LineString(coords)
            if not prepared.intersects(line):
                continue
            parts = line_parts(line.intersection(coverage))
            if not parts:
                continue
            properties = {'osm_id':way.id,'osm_type':'way','osm_version':way.version or None,'osm_timestamp_utc':stamp,
                          'power':'line','voltage':tags['voltage'],'voltage_v':voltages[0] if len(voltages)==1 else None,
                          'voltage_max_v':max(voltages),'location':tags.get('location'),
                          'aerial_basis':'explicit location=overhead' if tags.get('location') else 'power=line implies overhead (OSM)',
                          'name':tags.get('name'),'operator':tags.get('operator'),'osm_source_tag':tags.get('source'),
                          'selected_extract':source_id,'snapshot_at_utc':metadata['snapshot_at_utc'],
                          'attribution':'© OpenStreetMap contributors; Geofabrik','license':'ODbL-1.0'}
            record['feature'] = {'type':'Feature','id':'way/'+str(way.id),'properties':properties,'geometry':lfqo.geometry(parts)}
        del processor
    features = []
    for osm_id,record in sorted(records.items()):
        if record['feature']:
            record['feature']['properties']['source_extracts'] = ';'.join(sorted(record['sources']))
            features.append(record['feature'])
    return features,sources,dict(stats)


def covered_tiles(coverage,zoom):
    """Only positive-area intersections are covered. Holes and outside areas never become empty tiles."""
    west,south,east,north = coverage.bounds
    xmin,ymax = lfqo.tile_xy(west,south,zoom)
    xmax,ymin = lfqo.tile_xy(east,north,zoom)
    prepared = prep(coverage)
    for x in range(xmin,xmax+1):
        for y in range(ymin,ymax+1):
            bounds = lfqo.tile_bounds(zoom,x,y)
            rect = box(*bounds)
            if prepared.intersects(rect) and coverage.intersection(rect).area > 0:
                yield x,y,bounds,prepared.covers(rect)


def write_country(features,sources,stats,coverage,poly_path,profile,dataset,output_root,zoom=11):
    """New immutable directory per country/version; explicit empty files, footprint and checksums."""
    poly_bytes = Path(poly_path).read_bytes()
    generator_sha = hashlib.sha256(Path(__file__).read_bytes()+(HERE/'build.py').read_bytes()).hexdigest()
    identity = {'schema_version':2,'dataset':dataset,'profile':profile,'zoom':zoom,
                'inputs':[{k:s[k] for k in ('id','url','sha256','snapshot_at_utc')} for s in sources],
                'coverage_sha256':hashlib.sha256(poly_bytes).hexdigest(),'generator_sha256':generator_sha,
                'min_voltage_v':lfqo.MIN_VOLTAGE_V}
    version_sha = hashlib.sha256(lfqo.encode(identity)).hexdigest()
    dates = sorted(s['snapshot_at_utc'] for s in sources if s['snapshot_at_utc'])
    version = (dates[-1][:10].replace('-','') if dates else 'undated')+'-'+version_sha[:16]
    parent = Path(output_root)/dataset
    target = parent/version
    if target.exists():
        raise FileExistsError('Immutable version already exists: '+str(target))
    parent.mkdir(parents=True,exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.building-',dir=parent))
    try:
        tile_features = collections.defaultdict(list)
        for feature in features:
            parts = lfqo.parts_of(feature['geometry'])
            coords = [p for part in parts for p in part]
            xmin,ymax = lfqo.tile_xy(min(p[0] for p in coords),min(p[1] for p in coords),zoom)
            xmax,ymin = lfqo.tile_xy(max(p[0] for p in coords),max(p[1] for p in coords),zoom)
            for x in range(xmin,xmax+1):
                for y in range(ymin,ymax+1):
                    clipped = lfqo.clip_parts(parts,lambda a,b:lfqo.rectangle_segment(a,b,lfqo.tile_bounds(zoom,x,y)))
                    if clipped:
                        tile_features[x,y].append({**feature,'geometry':lfqo.geometry(clipped)})
        entries = []
        for x,y,bounds,full in covered_tiles(coverage,zoom):
            items = tile_features.get((x,y),[])
            key = 'tiles/{}/{}/{}.geojson'.format(zoom,x,y)
            data = lfqo.encode({'type':'FeatureCollection','features':items})
            path = stage/key
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(data)
            compressed = gzip.compress(data,mtime=0)
            path.with_suffix('.geojson.gz').write_bytes(compressed)
            entries.append({'key':key,'bbox':bounds,'coverage':'full' if full else 'partial','status':'data' if items else 'empty',
                            'features':len(items),'bytes':len(data),'gzip_bytes':len(compressed),'sha256':hashlib.sha256(data).hexdigest()})
        raw = lfqo.encode({'type':'FeatureCollection','features':features})
        (stage/'power-lines.geojson').write_bytes(raw)
        (stage/'power-lines.geojson.gz').write_bytes(gzip.compress(raw,mtime=0))
        footprint = lfqo.encode({'type':'Feature','properties':{'dataset':dataset},'geometry':mapping(coverage)})
        (stage/'coverage.geojson').write_bytes(footprint)
        snapshots = {s['id']:s['snapshot_at_utc'] for s in sources}
        manifest = {'schema_version':2,'dataset':dataset,'country_profile':profile,'version':version,'version_sha256':version_sha,
                    'generated_at_utc':lfqo.utc_now(),'generator_sha256':generator_sha,'sources':sources,'source_snapshots_utc':snapshots,
                    'source_dates_known':len(dates)==len(sources),'source_dates_aligned':len(dates)==len(sources) and len(set(dates))==1,
                    'coverage':{'key':'coverage.geojson','sha256':hashlib.sha256(footprint).hexdigest(),
                                'polygon_url':profile.get('polygon_url'),'polygon_input_sha256':identity['coverage_sha256'],
                                'bbox':list(coverage.bounds),'meaning':'Geofabrik extraction footprint, not an official national boundary; OSM coverage is non-exhaustive'},
                    'filter':{'power':'line','aerial':'existing LFQO qualifying_voltages rule','min_voltage_v':lfqo.MIN_VOLTAGE_V,
                              'multiple_values':'all components known positive integer volts; at least one >= 63000; preserve raw tag'},
                    'border_policy':'Clip to extraction footprint; same way/id may occur in adjacent countries with complementary/overlapping fragments. Merge by way/id AND segments, never drop the whole neighbouring fragment.',
                    'duplicate_policy':'Highest observed OSM version, then OSM timestamp, source snapshot, source id; filter applied AFTER version selection. Missing/deleted objects in older extractions cannot be reconstructed.',
                    'statistics':{**stats,'features':len(features),'tiles':len(entries),'empty_tiles':sum(e['status']=='empty' for e in entries),
                                  'geojson_bytes':len(raw),'tiles_bytes':sum(e['bytes'] for e in entries),'tiles_gzip_bytes':sum(e['gzip_bytes'] for e in entries)},
                    'tiling':{'scheme':'XYZ','zoom':zoom,'format':'GeoJSON, NOT MVT','empty_tiles':'explicit_files','outside_tiles':'not_covered, never implicitly empty',
                              'coordinates':'EPSG:4326 longitude,latitude','buffer':0,'tiles':entries},
                    'dataset_sha256':hashlib.sha256(raw).hexdigest(),'attribution':'© OpenStreetMap contributors; Geofabrik','license':'ODbL-1.0'}
        (stage/'manifest.json').write_bytes(lfqo.encode(manifest))
        stage.rename(target)
        return target,manifest
    finally:
        shutil.rmtree(stage,ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--country',required=True,choices=COUNTRIES)
    parser.add_argument('--input-dir',required=True,type=Path)
    parser.add_argument('--coverage-poly',required=True,type=Path,help='Already downloaded Geofabrik .poly for this country')
    parser.add_argument('--extra-input',action='append',default=[],metavar='COUNTRY=PATH',help='Optional already downloaded neighbouring extract; never downloaded automatically')
    parser.add_argument('--output-root',required=True,type=Path)
    parser.add_argument('--zoom',type=int,default=11,choices=range(8,15))
    parser.add_argument('--location-index',default='flex_mem',help='pyosmium node cache; use a disk-backed index for large inputs if needed')
    args = parser.parse_args()
    inputs = [(args.country,args.input_dir/(args.country+'.osm.pbf'))]
    urls = {args.country:COUNTRIES[args.country]['pbf_url']}
    for extra in args.extra_input:
        source_id,path = extra.split('=',1)
        if source_id not in COUNTRIES or source_id in urls:
            parser.error('Unknown or duplicate extra country: '+source_id)
        inputs.append((source_id,Path(path)))
        urls[source_id]=COUNTRIES[source_id]['pbf_url']
    coverage = read_poly(args.coverage_poly)
    features,sources,stats = collect_country(inputs,urls,coverage,args.location_index)
    target,manifest = write_country(features,sources,stats,coverage,args.coverage_poly,COUNTRIES[args.country],args.country,args.output_root,args.zoom)
    print(json.dumps({'output':str(target),'version':manifest['version'],'statistics':manifest['statistics']}))


if __name__ == '__main__':
    main()
