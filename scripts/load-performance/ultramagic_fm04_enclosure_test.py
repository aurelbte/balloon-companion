"""Targeted offline FM04 example proof and fail-closed checks."""
from fractions import Fraction as Q
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import ultramagic_fm04_enclosure as fm

class ArithmeticTests(unittest.TestCase):
    def test_split_is_exact(self):
        a,b=fm.split([(Q(0),Q(0)),(Q(3),Q(6))])
        self.assertEqual(a[-1],(Q(3,2),Q(3)))
        self.assertEqual(a[-1],b[0])

    def test_retained_hull_does_not_assume_precision(self):
        segment=[(Q(0),Q(0)),(Q(10),Q(20))]
        for depth in (0,1,8,24):
            lo,hi=fm.column_hull([segment],Q(4),Q(6),depth)
            self.assertLessEqual(lo,8)
            self.assertGreaterEqual(hi,12)

    def test_all_crossings_are_included(self):
        segments=[[(Q(0),Q(0)),(Q(10),Q(0))],
                  [(Q(0),Q(10)),(Q(10),Q(10))]]
        self.assertEqual(fm.column_hull(segments,Q(4),Q(6)),(Q(0),Q(10)))
        with self.assertRaises(fm.Refused):fm.column_hull(segments,Q(11),Q(12))

    def test_unknown_pdf_refused_before_decode(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'unknown.pdf';p.write_bytes(b'unknown')
            with patch.object(fm.subprocess,'check_output') as decoder:
                with self.assertRaisesRegex(fm.Refused,'UNREVIEWED_PDF'):fm.extract(p)
                decoder.assert_not_called()

@unittest.skipUnless(fm.MANUAL.exists() and shutil.which('swift'),'Local FM04 PDF / Swift required')
class DocumentaryCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content=fm.extract(fm.MANUAL)
        cls.geometry=fm.prepare_direct_geometry(cls.content)

    def test_example_lower_bound_without_physical_or_operational_claim(self):
        result=fm.prove_example(self.content)
        self.assertEqual(result['liftKgPer1000Ft3Interval'],['6.5','7'])
        self.assertEqual(result['nominalTotalLiftLowerKg'],'422.5')
        self.assertFalse(result['activation']);self.assertFalse(result['admissibleLoad'])
        self.assertNotIn('marginKg',result)
        lo,hi=map(Q,result['outlineYExact'])
        self.assertTrue(Q('309.96')<lo<hi<Q('369.33'))
        # The tighter 6.6 band is NOT justified by the full black/green ink hull.
        self.assertGreater(hi,Q('321.18'))

    def test_no_extension_to_cold_example_or_other_volume(self):
        for options in [dict(ground_c='10'),dict(launch_m='301'),dict(maximum_m='3001'),
                        dict(volume_1000ft3='64.98')]:
            with self.assertRaisesRegex(fm.Refused,'ONLY_DOCUMENTED'):fm.prove_example(self.content,**options)

    def test_changes_to_annotation_grid_clipping_transform_and_contours_fail_closed(self):
        mutations=[('2.3622 w','4 w'),('66.216 309.96 m','66.216 320 m'),
                   ('66.216 232.84 553.15 144.46 re','66.216 330 553.15 1 re'),
                   ('67.397 1032.23 m','67.397 1033 m')]
        for old,new in mutations:
            with self.assertRaises(fm.Refused):fm.prove_example(self.content.replace(old,new))
        with self.assertRaises(fm.Refused):fm.prove_example('1 0 0 1 0 0 cm\n'+self.content)

    def test_direct_representative_readings(self):
        for t,h,expected in [(20,0,['7','15/2']),(0,3000,['13/2','7']),
                             (-20,7000,['5','11/2'])]:
            row=fm.evaluate(self.content,t,h,h,self.geometry)
            self.assertEqual(row['status'],'DIRECT_PRINTED_CURVE_GEOMETRY_ONLY')
            self.assertEqual(row['liftKgPer1000Ft3Interval'],expected)
            self.assertEqual(row['isaTransport'],'IDENTITY_NO_ALTITUDE_CHANGE')
            self.assertFalse(row['activation']);self.assertFalse(row['admissibleLoad'])

    def test_intermediate_temperature_encloses_whole_tick_gap_not_affine_fit(self):
        row=fm.evaluate(self.content,5,3000,3000,self.geometry)
        self.assertEqual(row['temperatureXExact'],['18611/50','2173/5'])
        self.assertEqual(row['liftKgPer1000Ft3Interval'],['11/2','7'])

    def test_transport_and_intermediate_altitudes_remain_explicitly_unproven(self):
        for t,a,b in [(10,300,3000),(20,0,3000),(20,1000,3000),(20,500,3500)]:
            row=fm.evaluate(self.content,t,a,b,self.geometry)
            self.assertEqual(row['status'],'REFUSED')
            self.assertIn('ISA_PARALLEL_TRANSPORT_NOT_DOCUMENTARILY_ENCLOSED',row['reasons'])
            if a not in fm.ALTITUDE_OUTLINES or b not in fm.ALTITUDE_OUTLINES:
                self.assertIn('INTERMEDIATE_ALTITUDE_NOT_DEFINED',row['reasons'])
            self.assertNotIn('lowerLiftKgPer1000Ft3',row)
        row=fm.evaluate(self.content,20,500,500,self.geometry)
        self.assertEqual(row['reasons'],['INTERMEDIATE_ALTITUDE_NOT_DEFINED'])
        illustrated=fm.evaluate(self.content,20,300,3000,self.geometry)
        self.assertEqual(illustrated['isaTransport'],
                         'PUBLISHED_ANNOTATION_ONLY_NOT_GENERAL_TRANSPORT_PROOF')

    def test_domains_clipping_and_calibration_refuse_without_clamping(self):
        cases=[(20,-1,3000),(20,4000,3000),(41,0,0),(20,0,7001)]
        for case in cases:
            self.assertEqual(fm.evaluate(self.content,*case,self.geometry)['reasons'],['OUTSIDE_PRINTED_DOMAIN'])
        for t in (-50,40):
            self.assertEqual(fm.evaluate(self.content,t,3000,3000,self.geometry)['reasons'],
                             ['OUTSIDE_QUALIFIED_TEMPERATURE_CALIBRATION'])
        for bad in ('NaN','Infinity','oops'):
            self.assertEqual(fm.evaluate(self.content,bad,0,0,self.geometry)['reasons'],['INVALID_NUMERIC_INPUT'])
        self.assertEqual(fm.evaluate(self.content,-40,0,0,self.geometry)['status'],'REFUSED')
        for source,replacement in [('0 g','1 0 0 1 0 0 cm'),
                                   ('617.89 309.96 l','617.89 311 l'),
                                   ('70.349 1023.96','70.349 1024.96')]:
            # Mutating only one duplicate must not be silently averaged.
            with self.assertRaises(fm.Refused):
                fm.prepare_direct_geometry(self.content.replace(source,replacement,1))

    def test_clip_union_requires_overlaps_and_never_fills_a_gap(self):
        rects=[(Q(0),Q(0),Q(10),Q(6)),(Q(0),Q(5),Q(10),Q(10))]
        self.assertTrue(fm.clips_cover_band(rects,Q(4),Q(6),Q(1),Q(9)))
        for second_start in (Q(6),Q(7)):
            disjoint=[rects[0],(Q(0),second_start,Q(10),Q(10))]
            self.assertFalse(fm.clips_cover_band(disjoint,Q(4),Q(6),Q(1),Q(9)))
        self.assertFalse(fm.clips_cover_band(rects,Q(0),Q(6),Q(1),Q(9)))

    def test_published_coverage_is_reproducible_and_has_no_general_transport_proof(self):
        import json
        report=fm.coverage(self.content)
        published=json.loads((fm.ROOT/'docs/load-performance/ultramagic-fm04-coverage.json').read_text())
        self.assertEqual(report,published)
        self.assertEqual(report['certifiedGeneralIsaTransports'],0)
        self.assertFalse(report['intermediateAltitudeConstructionCertified'])
        self.assertEqual(report['directIntegerSummary']['enclosed'],258)
        self.assertEqual(report['sampleGridSummary']['enclosed'],34)
        for rows in (report['representatives'],report['sampleGrid'],report['directIntegerCases']):
            for row in rows:
                self.assertFalse(row['activation']);self.assertFalse(row['admissibleLoad'])
                self.assertNotIn('marginKg',row)
                if row['status']=='REFUSED':
                    self.assertTrue(row['reasons']);self.assertNotIn('lowerLiftKgPer1000Ft3',row)
                else:
                    lo,hi=map(Q,row['liftKgPer1000Ft3Interval'])
                    self.assertTrue(Q('4.5')<=lo<=hi<=10)

if __name__=='__main__':unittest.main()
