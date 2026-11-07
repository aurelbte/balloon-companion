"""Targeted tests of the published ISA annotation replay, not a load calculator."""
from fractions import Fraction as Q
import json
import shutil
import unittest
import ultramagic_fm04_enclosure as fm
import ultramagic_fm04_isa_replay as isa

class CrossingTests(unittest.TestCase):
    def test_exact_endpoints_and_rational_de_casteljau(self):
        self.assertEqual(isa.point(isa.TRANSPORT,Q(0)),isa.P2)
        self.assertEqual(isa.point(isa.TRANSPORT,Q(1)),isa.P3)
        self.assertEqual(isa.VERTICAL[-1],isa.TRANSPORT[0])
        self.assertEqual(isa.P3[1],isa.P4[1])

    def test_unique_crossing_enclosed_without_forcing_an_uncertain_sign(self):
        result=isa.crossing([(Q(10),Q(10)),(Q(0),Q(0))],
                            [(Q(-1),Q(11)),(Q(11),Q(-1))])
        lo,hi=map(Q,result['parameterExact'])
        self.assertTrue(lo<=Q(1,2)<=hi)
        self.assertTrue(result['stoppedOnUnresolvedSign'])
        xl,xh=map(Q,result['xExact']);yl,yh=map(Q,result['yExact'])
        self.assertTrue(xl<=5<=xh and yl<=5<=yh)

    def test_ambiguous_direction_and_missing_crossings_are_refused(self):
        green=[(Q(10),Q(10)),(Q(0),Q(0))]
        edges=[[(Q(-1),Q(11)),(Q(11),Q(12))], # same slope
               [(Q(-1),Q(31)),(Q(11),Q(19))], # no sign bracket
               [(Q(-1),Q(11)),(Q(11),Q(11))], # flat
               [(Q(0),Q(10)),(Q(5),Q(-1))]] # does not span whole path
        for edge in edges:
            with self.assertRaises(fm.Refused):isa.crossing(green,edge)

@unittest.skipUnless(fm.MANUAL.exists() and shutil.which('swift'),'Local FM04 PDF / Swift required')
class PublishedExampleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.content=fm.extract(fm.MANUAL)

    def test_exact_h65_annotation_and_disconnected_isa_evidence(self):
        r=isa.replay(self.content)
        self.assertEqual(r['pointsExact']['2'],list(map(str,isa.P2)))
        self.assertEqual(r['annotatedFirstLegDeltaXExact'],'29/100')
        self.assertEqual(r['isa']['identicalClippedCopies'],4)
        self.assertFalse(r['isa']['continuousReferenceCurveDefined'])
        self.assertTrue(r['launchIntersectionEvidence']['p2BetweenTheseCurves'])
        self.assertFalse(r['launchIntersectionEvidence']['altitude300mIntersectionCertified'])
        self.assertEqual(r['exactProductOfPublishedReadoutAndNominalVolumeKg'],'425.75')
        self.assertEqual(r['publishedTotalLiftKg'],426)
        self.assertFalse(r['reconstructedIsaTransport'])
        self.assertFalse(r['activation']);self.assertFalse(r['admissibleLoad'])
        self.assertNotIn('marginKg',r)

    def test_actual_boundary_crossings_precede_published_p3(self):
        r=isa.replay(self.content)
        self.assertLess(isa.P3[1],Q(r['blackOutlineAtP3XExact'][0]))
        self.assertEqual(len(r['actual3000mInkBoundaryCrossings']),2)
        for c in r['actual3000mInkBoundaryCrossings']:
            tl,th=map(Q,c['parameterExact'])
            xl,xh=map(Q,c['xExact']);yl,yh=map(Q,c['yExact'])
            self.assertTrue(0<tl<=th<1)
            self.assertTrue(isa.P3[0]<xl<=xh<isa.P2[0])
            self.assertTrue(isa.P3[1]<yl<=yh<isa.P2[1])
        self.assertIn('P3_NOT_EXACTLY',r['steps'][2]['derivation'])

    def test_second_documented_case_is_refused_without_a_vector_construction(self):
        r=isa.replay(self.content,'10')
        self.assertEqual(r['status'],'REFUSED')
        self.assertEqual(r['publishedApproximateTotalLiftKg'],488)
        self.assertIn('SECOND_CASE_HAS_NO_PUBLISHED_VECTOR_CONSTRUCTION',r['reasons'])
        self.assertNotIn('replay',r)
        self.assertFalse(r['admissibleLoad'])
        with self.assertRaises(fm.Refused):isa.replay(self.content,'15')

    def test_mutated_annotation_isa_or_contours_fail_closed(self):
        for old,new in [('385.21 315.57 m','386.21 315.57 m'),
                        ('455.88 476.57 m','455.89 476.57 m'),
                        ('70.349 1023.96','70.349 1024.96')]:
            with self.assertRaises(fm.Refused):isa.replay(self.content.replace(old,new,1))

    def test_published_replay_report_matches_exact_geometry(self):
        p=fm.ROOT/'docs/load-performance/ultramagic-fm04-isa-replay.json'
        self.assertEqual(json.loads(p.read_text()),
                         dict(case20C=isa.replay(self.content),case10C=isa.replay(self.content,'10')))

if __name__=='__main__':unittest.main()
