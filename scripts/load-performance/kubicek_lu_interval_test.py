"""Targeted exact-arithmetic/proof-refusal tests; no aircraft activation."""
from fractions import Fraction as Q
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import kubicek_lu_interval as lu
from kubicek_pdf_content import extract_page69_content

LOCAL=lu.ROOT/'.load-performance-work/manuals/kubicek-b3102-rev22.pdf'

class ExactArithmeticTests(unittest.TestCase):
    def test_outward_display_does_not_narrow(self):
        interval=lu.Interval(Q(-1,3),Q(1,3))
        low,high=map(Q,interval.report())
        self.assertLessEqual(low,interval.lo)
        self.assertGreaterEqual(high,interval.hi)

    def test_exact_bezier_no_binary_float(self):
        points=[(Q(0),Q(0)),(Q(1),Q(1)),(Q(2),Q(2)),(Q(3),Q(3))]
        self.assertEqual(lu.bezier(points,Q(1,3)),(Q(1),Q(1)))

    def test_linear_crossing_encloses_root_for_any_budget(self):
        segment=[(Q(0),Q(0)),(Q(10),Q(10))]
        for budget in (1,8,48):
            result=lu.crossing([segment],lu.Interval(Q(5),Q(5)),Q(0),budget)
            self.assertLessEqual(result.lo,5)
            self.assertGreaterEqual(result.hi,5)

    def test_entire_stroke_and_temperature_band_are_included(self):
        result=lu.crossing([[(Q(0),Q(0)),(Q(10),Q(10))]],lu.Interval(Q(49,10),Q(51,10)),Q(1,10))
        # y reading +/-0.1, centreline stroke y +/-0.1, stroke x +/-0.1.
        self.assertLessEqual(result.lo,Q(47,10))
        self.assertGreaterEqual(result.hi,Q(53,10))

    def test_cubic_crossing_encloses_exact_known_root(self):
        points=[(Q(0),Q(0)),(Q(1),Q(1)),(Q(2),Q(2)),(Q(3),Q(3))]
        result=lu.crossing([points],lu.Interval(Q(1),Q(1)),Q(0))
        self.assertLessEqual(result.lo,1)
        self.assertGreaterEqual(result.hi,1)

    def test_geometrically_ambiguous_or_missing_intersections_refused(self):
        curves=[
            [[(Q(0),Q(0)),(Q(1),Q(0))]], # flat y
            [[(Q(0),Q(0)),(Q(1),Q(2)),(Q(2),Q(-1)),(Q(3),Q(3))]], # fold
            [[(Q(0),Q(0)),(Q(1),Q(1))],[(Q(2),Q(2)),(Q(3),Q(3))]], # gap
            [[(Q(0),Q(0)),(Q(-1),Q(1))]], # unqualified x direction
        ]
        for curve in curves:
            with self.assertRaises(lu.Refused):
                lu.crossing(curve,lu.Interval(Q(1,2),Q(1,2)),Q(0))
        with self.assertRaisesRegex(lu.Refused,'ENDPOINT'):
            lu.crossing([[(Q(0),Q(0)),(Q(1),Q(1))]],lu.Interval(Q(2),Q(2)),Q(0))

    def test_uncertain_grid_separation_does_not_produce_sub_tick_precision(self):
        ticks={k:lu.Interval(Q(30-k),Q(30-k)) for k in range(10,24)}
        self.assertEqual(lu.bound_from_ticks(lu.Interval(Q(135,10),Q(139,10)),ticks),lu.Interval(Q(16),Q(17)))
        for x in (lu.Interval(Q(21),Q(22)),lu.Interval(Q(5),Q(6))):
            with self.assertRaises(lu.Refused): lu.bound_from_ticks(x,ticks)

    def test_unknown_pdf_is_refused_before_extraction(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'unknown.pdf'
            path.write_bytes(b'not the reviewed PDF')
            with patch.object(lu,'extract_page69_content') as extract:
                with self.assertRaisesRegex(lu.Refused,'UNREVIEWED_PDF'):
                    lu.certify(path,'5500','16.7')
                extract.assert_not_called()

@unittest.skipUnless(LOCAL.exists() and shutil.which('swift'),'Local reviewed PDF / macOS Swift required')
class ReviewedCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content=extract_page69_content(LOCAL)

    def test_calibration_and_whole_ink_geometry_bound_example(self):
        x,y,ticks=lu.qualify_geometry(self.content)
        self.assertEqual(lu.bound_from_ticks(x,ticks),lu.Interval(Q(16),Q(17)))
        self.assertLess(x.hi,ticks[16].lo)
        self.assertGreater(x.lo,ticks[17].hi)
        self.assertEqual(y,lu.Interval(Q('483.8857'),Q('484.1247')))

    def test_real_altitude_temperature_then_upper_steps(self):
        with patch.object(lu,'extract_page69_content',return_value=self.content):
            result=lu.certify(LOCAL,'5500','16.7')
        self.assertEqual(result['temperatureAtActualAltitudeC'],'29017/5000')
        self.assertEqual((result['upperAltitudeFt'],result['upperTemperatureC']),(6000,6))
        self.assertEqual(result['luInterval'],['16','17'])
        self.assertFalse(result['activation'])
        self.assertNotIn('marginKg',result)

    def test_official_example_6000ft_6C_same_conservative_lower_bound(self):
        with patch.object(lu,'extract_page69_content',return_value=self.content):
            result=lu.certify(LOCAL,'6000','17.8872')
        self.assertEqual(result['temperatureAtActualAltitudeC'],'6')
        self.assertEqual(result['lowerLiftUnits'],'16') # No rounding 16.539624, and not forced to 16.5.

    def test_nonqualified_case_or_domain_is_refused_not_extrapolated(self):
        for height,temp in [('-1','10'),('30001','10'),('5500','100')]:
            with patch.object(lu,'extract_page69_content') as extract:
                with self.assertRaises(lu.Refused):lu.certify(LOCAL,height,temp)
                extract.assert_not_called()

    def test_generalized_steps_preserve_temperature_at_actual_altitude(self):
        for height,temp,expected in [('6000.000001','17.8872',(8000,6)),
                                     ('5500','16.896601',(6000,7))]:
            with patch.object(lu,'extract_page69_content',return_value=self.content):
                result=lu.certify(LOCAL,height,temp)
            self.assertEqual((result['upperAltitudeFt'],result['upperTemperatureC']),expected)

    def test_inherited_12500_clip_requires_no_intervening_operator(self):
        curve=lu.parse_curve(self.content,12500)
        self.assertEqual(curve[1:],lu.parse_curve(self.content,8000)[1:])
        changed=self.content.replace('q 1 0 0 1 124.5933', '0 J\nq 1 0 0 1 124.5933')
        with self.assertRaisesRegex(lu.Refused,'INHERITED_CURVE_STATE_AMBIGUOUS'):
            lu.parse_curve(changed,12500)

    def test_all_pairs_and_published_cross_revision_bounds(self):
        report=lu.ROOT/'docs/load-performance/kubicek-lu-interval-coverage.json'
        import json
        published=json.loads(report.read_text())
        with patch.object(lu,'extract_page69_content',return_value=self.content):
            current=lu.coverage(LOCAL)
        self.assertEqual(current,published['manuals'][0])
        self.assertEqual(len(current['pairs']),15*76)
        self.assertTrue(lu.compare_coverage(*published['manuals'])['identical'])
        for row in current['pairs']:
            if row['status']=='ENCLOSED':
                low,high=map(Q,row['luInterval'])
                self.assertTrue(10<=low<=high<=23)
                self.assertEqual(str(low),row['lowerLiftUnits'])
            else:
                self.assertTrue(row['reason'])
        self.assertFalse(current['activation'])

    def test_calibration_clip_style_and_transforms_are_fail_closed(self):
        variants=[
            self.content.replace('0.239 w 1 j','0.239 w 0 j'),
            self.content.replace('131.512 105.489 337.002 617.818 re','309 105.489 1 617.818 re'),
            self.content.replace('0.954 w 1 J','0.954 w 0 J'),
            self.content.replace('0.954 w 1 J \nq 1 0 0 1 -77.0118','0.954 w 1 J \n1 0 0 1 10 0 cm\nq 1 0 0 1 -77.0118'),
        ]
        for content in variants:
            with self.assertRaises(lu.Refused):lu.qualify_geometry(content)

if __name__=='__main__':unittest.main()
