"""One targeted end-to-end fixture test; no network, no application routes."""
import json
from pathlib import Path
import tempfile
import unittest
import build
import hashlib
import country_build
from shapely.geometry import box, shape


class PrototypeTest(unittest.TestCase):
    def test_filter_clip_deduplicate_provenance_and_tiles(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            coordinates = [build.project(p, inverse=True) for p in [(-30000,0),(30000,0),(0,0),(1000,1000),(30000,30000),(31000,31000)]]
            nodes = ''.join('<node id="{}" lon="{}" lat="{}"/>'.format(i,*point) for i,point in enumerate(coordinates,1))
            ways = '''<way id="201" version="1" timestamp="2026-11-10T00:00:00Z"><nd ref="1"/><nd ref="2"/><tag k="power" v="line"/><tag k="voltage" v="225000"/></way>
<way id="202" version="1"><nd ref="3"/><nd ref="4"/><tag k="power" v="minor_line"/><tag k="voltage" v="400000"/></way>
<way id="203"><nd ref="3"/><nd ref="4"/><tag k="power" v="cable"/></way>
<way id="204"><nd ref="5"/><nd ref="6"/><tag k="power" v="line"/><tag k="voltage" v="63000"/></way>
<way id="205"><nd ref="3"/><tag k="power" v="line"/><tag k="voltage" v="63000"/></way>'''
            examples = [(206,'63000',{}),(207,'20000;63000',{}),(208,'400000;225000',{}),
                        (209,'60000',{}),(210,None,{}),(211,'unknown',{}),
                        (212,'225000',{'location':'underground'}),(213,'225000',{'location':'underwater'}),
                        (214,'225000',{'tunnel':'yes'}),(215,'225000',{'location':'overhead'}),
                        (216,'225000;unknown',{}),(218,'63000',{'underground':'yes'}),(219,'63000',{'submarine':'yes'})]
            for identifier, voltage, extra in examples:
                tags={'power':'line', **extra}
                if voltage is not None:
                    tags['voltage']=voltage
                ways += '<way id="{}" version="1"><nd ref="3"/><nd ref="4"/>{}</way>'.format(identifier,
                    ''.join('<tag k="{}" v="{}"/>'.format(k,v) for k,v in tags.items()))
            xml = '<osm version="0.6" generator="synthetic-targeted-test">'+nodes+ways+'</osm>'
            inputs = []
            for key in build.SOURCES:
                path=root/(key+'.osm')
                path.write_text(xml)
                inputs.append((key,path))
            features,sources,stats = build.collect(inputs)
            self.assertEqual([f['id'] for f in features],['way/201','way/206','way/207','way/208','way/215'])
            self.assertEqual(features[0]['properties']['voltage'],'225000')
            self.assertEqual(features[0]['properties']['voltage_v'],225000)
            by_id={f['id']:f for f in features}
            self.assertEqual(by_id['way/206']['properties']['voltage_max_v'],63000)
            self.assertEqual(by_id['way/207']['properties']['voltage'],'20000;63000')
            self.assertEqual(by_id['way/207']['properties']['voltage_max_v'],63000)
            self.assertEqual(by_id['way/208']['properties']['voltage_max_v'],400000)
            self.assertEqual(features[0]['properties']['source_extracts'],'belgium;nord-pas-de-calais')
            self.assertEqual(stats['invalid_or_missing_geometry_ways'],2)
            self.assertTrue(all(s['sha256'] and s['snapshot_at_utc'] is None for s in sources))
            for feature in features:
                for part in build.parts_of(feature['geometry']):
                    for point in part:
                        self.assertLessEqual(sum(v*v for v in build.project(point))**.5, build.RADIUS_M+.02)
            manifest = build.write_outputs(features,sources,stats,root/'output',11)
            self.assertGreater(manifest['statistics']['tiles'],1)  # crossing with both original endpoints outside
            self.assertEqual(manifest['statistics']['missing_voltage'],0)
            self.assertEqual(manifest['filter']['min_voltage_v'],63000)
            for tile in manifest['tiling']['tiles']:
                west,south,east,north = tile['bbox']
                for feature in json.loads((root/'output'/tile['key']).read_text())['features']:
                    for part in build.parts_of(feature['geometry']):
                        for lon,lat in part:
                            self.assertTrue(west-1e-7 <= lon <= east+1e-7 and south-1e-7 <= lat <= north+1e-7)
                    self.assertEqual(feature['properties']['power'],'line')
                    self.assertGreaterEqual(feature['properties']['voltage_max_v'],63000)
                    self.assertEqual(feature['properties']['license'],'ODbL-1.0')

            # Same single LFQO fixture exercises the offline country extension.
            self.assertEqual(set(country_build.COUNTRIES), {'france','belgium','morocco','united-kingdom'})
            poly = root/'lfqo.poly'
            poly.write_text('LFQO fixture\n1\n2.9 50.5\n3.3 50.5\n3.3 50.8\n2.9 50.8\n2.9 50.5\nEND\n!hole\n3.06 50.68\n3.07 50.68\n3.07 50.69\n3.06 50.69\n3.06 50.68\nEND\nEND\n')
            coverage = country_build.read_poly(poly)
            self.assertEqual(len(coverage.geoms[0].interiors),1)
            # A newer low-voltage observation must supersede an older eligible way.
            belgium = dict(inputs)['belgium']
            belgium.write_text(xml.replace('<way id="206" version="1">','<way id="206" version="2">').replace(
                '<way id="206" version="2"><nd ref="3"/><nd ref="4"/><tag k="power" v="line"/><tag k="voltage" v="63000"/>',
                '<way id="206" version="2"><nd ref="3"/><nd ref="4"/><tag k="power" v="line"/><tag k="voltage" v="60000"/>'))
            urls = {key:build.SOURCES[key] for key,path in inputs}
            selected,provenance,counters = country_build.collect_country(inputs,urls,coverage)
            ids = [f['id'] for f in selected]
            self.assertEqual(ids,['way/201','way/207','way/208','way/215'])
            self.assertEqual(len(ids),len(set(ids)))
            self.assertEqual(selected[0]['geometry']['type'],'MultiLineString')
            self.assertEqual(selected[0]['properties']['source_extracts'],'belgium;nord-pas-de-calais')
            for feature in selected:
                self.assertTrue(coverage.buffer(1e-7).covers(shape(feature['geometry'])))
            # A cross-border way retains complementary fragments and the same global OSM id.
            for mask in (box(2.9,50.5,3.08,50.8),box(3.08,50.5,3.3,50.8)):
                fragments,_,_ = country_build.collect_country(inputs,urls,coverage.intersection(mask))
                self.assertIn('way/201',[f['id'] for f in fragments])
                self.assertTrue(mask.buffer(1e-7).covers(shape(fragments[0]['geometry'])))
            profile = {'name':'LFQO synthetic validation','polygon_url':None}
            output,national = country_build.write_country(selected,provenance,counters,coverage,poly,profile,'lfqo-validation',root/'countries')
            self.assertEqual(national['schema_version'],2)
            self.assertTrue(national['version'].startswith('undated-'))
            self.assertFalse(national['source_dates_known'])
            self.assertGreater(national['statistics']['empty_tiles'],0)
            self.assertEqual(hashlib.sha256((output/'power-lines.geojson').read_bytes()).hexdigest(),national['dataset_sha256'])
            self.assertEqual(hashlib.sha256((output/'coverage.geojson').read_bytes()).hexdigest(),national['coverage']['sha256'])
            for tile in national['tiling']['tiles']:
                raw = (output/tile['key']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(),tile['sha256'])
                self.assertGreater(coverage.intersection(box(*tile['bbox'])).area,0)
                items = json.loads(raw)['features']
                self.assertEqual(tile['status'],'data' if items else 'empty')
                self.assertEqual(len({f['id'] for f in items}),len(items))
                self.assertEqual(tile['coverage'],'full' if coverage.covers(box(*tile['bbox'])) else 'partial')
                for feature in items:
                    self.assertTrue(box(*tile['bbox']).buffer(1e-7).covers(shape(feature['geometry'])))
            with self.assertRaises(FileExistsError):
                country_build.write_country(selected,provenance,counters,coverage,poly,profile,'lfqo-validation',root/'countries')


if __name__ == '__main__':
    unittest.main()
