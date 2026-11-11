"""One targeted end-to-end fixture test; no network, no application routes."""
import json
from pathlib import Path
import tempfile
import unittest
import build


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


if __name__ == '__main__':
    unittest.main()
