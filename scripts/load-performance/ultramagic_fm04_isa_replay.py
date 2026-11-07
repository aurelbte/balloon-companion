"""Replay FM04 H65 annotation exactly; reject an inferred ISA construction.
Offline only. No theoretical lift formula, altitude steps, activation or margin.
"""
from fractions import Fraction as Q
import hashlib
import json
import re

import ultramagic_fm04_enclosure as fm

# Explicit annotation bindings on p.5.3 (not inferred from the candidate formula).
P1=(Q('495.5'),Q('66.823'))
P2=(Q('495.79'),Q('381.14'))
P3=(Q('385.21'),Q('315.57'))
P4=(Q('66.216'),Q('315.57'))
VERTICAL=[P1,P2,P2,P2]
TRANSPORT=[P2,(Q('468.31'),Q('376.12')),(Q('422.76'),Q('346.87')),P3]
ANNOTATION='''2.3622 w
0.0863 0.769 0.0314 RG

495.5 66.823 m
495.79 381.14 495.79 381.14 495.79 381.14 c
468.31 376.12 422.76 346.87 385.21 315.57 c
S

385.21 315.57 m
66.216 315.57 l
S'''


def point(points,t):
    while len(points)>1:
        points=[tuple((1-t)*a[j]+t*b[j] for j in (0,1)) for a,b in zip(points,points[1:])]
    return points[0]


def strict_direction(points,axis):
    differences=[b[axis]-a[axis] for a,b in zip(points,points[1:])]
    if all(d>0 for d in differences): return 1
    if all(d<0 for d in differences): return -1
    raise fm.Refused('NON_STRICT_OR_AMBIGUOUS_BRANCH')


def crossing(transport,edge,budget=40):
    """Unique crossing of two oppositely sloped x-monotone branches.

    Existence: endpoint signs bracket zero; inverse x maps are continuous.
    Uniqueness: transport y(x) increases strictly, edge y(x) decreases strictly.
    Retain ALL inversion/subdivision uncertainty; never choose an uncertain sign.
    The black edge is a boundary of FILLED ink, not a manufactured centreline.
    """
    fm.require(budget>=1,'INVALID_SUBDIVISION_BUDGET')
    fm.require(strict_direction(transport,0)==strict_direction(transport,1)==-1,
               'UNSUPPORTED_TRANSPORT_DIRECTION')
    fm.require(strict_direction(edge,0)*strict_direction(edge,1)==-1,
               'UNSUPPORTED_EDGE_DIRECTION')
    xmin,xmax=sorted((edge[0][0],edge[-1][0]))
    fm.require(xmin<transport[-1][0]<transport[0][0]<xmax,'EDGE_DOES_NOT_COVER_TRANSPORT')
    def sign(t):
        x,y=point(transport,t)
        low,high=fm.column_hull([edge],x,x,32)
        if y>high: return 1
        if y<low: return -1
        return 0
    fm.require(sign(Q(0))==1 and sign(Q(1))==-1,'NO_PROVEN_INTERSECTION_BRACKET')
    lo,hi=Q(0),Q(1); stopped=False
    for _ in range(budget):
        mid=(lo+hi)/2
        s=sign(mid)
        if s==1: lo=mid
        elif s==-1: hi=mid
        else:
            stopped=True;break  # Retain enclosing bracket, no epsilon or forced side.
    left,right=point(transport,lo),point(transport,hi)
    return dict(status='UNIQUE_FILLED_CONTOUR_BOUNDARY_CROSSING_ENCLOSED',
                parameterExact=[str(lo),str(hi)],xExact=[str(right[0]),str(left[0])],
                yExact=[str(right[1]),str(left[1])],
                stoppedOnUnresolvedSign=stopped,
                arithmetic='Exact rational de Casteljau; retained outer control hulls')


def isa_evidence(content):
    # Central ISA dotted guide, visually linked to its ISA 0 label on p.5.3.
    # Do not join dots, fit their centres, or use a different ISA-offset guide.
    matches=list(re.finditer(r'455\.88 476\.57 m\n(.*?)\nh\nf\n',content,re.S))
    fm.require(len(matches)==4 and len({m[0] for m in matches})==1,
               'ISA_REFERENCE_MISSING_OR_AMBIGUOUS')
    compound=matches[0][0]
    dots=re.findall(r'^([-\d.]+) ([-\d.]+) m\n(.*?)\nh',compound,re.M|re.S)
    fm.require(len(dots)==65,'ISA_DOT_COUNT_CHANGED')
    boxes=[]
    for x,y,body in dots:
        vertices=[(Q(x),Q(y))]
        for line in body.splitlines():
            parts=line.split()
            fm.require(parts[-1]=='c' and len(parts)==7,'UNSUPPORTED_ISA_DOT_GEOMETRY')
            n=list(map(Q,parts[:-1]));vertices.extend((n[i],n[i+1]) for i in (0,2,4))
        boxes.append((min(v[0] for v in vertices),max(v[0] for v in vertices)))
    fm.require(all(b[1]<a[0] for a,b in zip(boxes,boxes[1:])),
               'ISA_COMPONENT_SEPARATION_NOT_PROVEN')
    return dict(guide='ISA 0',representation='65 filled disconnected cubic dot contours',
                identicalClippedCopies=4,compoundSha256=hashlib.sha256(compound.encode()).hexdigest(),
                continuousReferenceCurveDefined=False,centresOrConnectionsFitted=False,
                status='DOTTED_REFERENCE_IDENTIFIED_NO_CONTINUOUS_TRANSPORT_RULE')


def replay(content,ground_c='20'):
    fm.require(content.count(ANNOTATION)==1,'ANNOTATED_PATH_MISSING_OR_AMBIGUOUS')
    geometry=fm.prepare_direct_geometry(content)
    reference=isa_evidence(content)
    if Q(ground_c)!=20:
        fm.require(Q(ground_c)==10,'NO_DOCUMENTED_SECOND_CASE')
        return dict(status='REFUSED',input=dict(model='H65',groundC=10,launchM=300,maximumM=3000),
                    publishedApproximateTotalLiftKg=488,
                    reasons=['SECOND_CASE_HAS_NO_PUBLISHED_VECTOR_CONSTRUCTION',
                             'ISA_TRANSPORT_RULE_NOT_DEFINED',
                             '300M_ALTITUDE_CURVE_NOT_PUBLISHED'],
                    activation=False,admissibleLoad=False)
    # All vertices and continuity are literal PDF decimals, converted to Q.
    fm.require(VERTICAL[-1]==TRANSPORT[0] and TRANSPORT[-1]==P3 and P3[1]==P4[1],
               'DISCONNECTED_ANNOTATED_PATH')
    fm.require(Q('494.91')<=P1[0]<=P2[0]<=Q('495.79'),'START_NOT_ON_PRINTED_20C_BAND')
    edges=geometry[0][3000]
    # Only long arcs spanning the WHOLE transport x range can be candidates.
    candidates=[e for e in edges if min(e[0][0],e[-1][0])<P3[0]
                and max(e[0][0],e[-1][0])>P2[0]]
    fm.require(len(candidates)==2,'AMBIGUOUS_3000M_BOUNDARIES')
    intersections=[crossing(TRANSPORT,e) for e in candidates]
    for result in intersections:
        xl,xh=map(Q,result['xExact']);yl,yh=map(Q,result['yExact'])
        fm.require(fm.clips_cover_band(geometry[1][3000],xl,xh,yl,yh),
                   'INTERSECTION_CLIP_UNCERTAIN')
    # At the actual P3 abscissa, even the entire black outline is above P3.
    black_lo,black_hi=fm.column_hull(edges,P3[0],P3[0],32)
    fm.require(P3[1]<black_lo,'P3_ALIGNMENT_NOT_RESOLVED')
    sea=fm.column_hull(geometry[0][0],P2[0],P2[0],32)
    thousand=fm.column_hull(geometry[0][1000],P2[0],P2[0],32)
    fm.require(thousand[1]<P2[1]<sea[0],'P2_NOT_BETWEEN_PRINTED_ALTITUDE_CONTOURS')
    known=fm.prove_example(content)
    return dict(status='EXACT_PUBLISHED_PATH_REPLAYED_DERIVATION_REFUSED',
                sourceSha256=fm.SHA,pages='5.3 Rev.23 / 5.5 Rev.25, PDF 42 / 44',
                axes=dict(x='Temperature C, printed -50 to +40',
                          y='Lift kg/1000 ft3, printed 4.5 to 10; envelope 100 C'),
                isa=reference,input=dict(model='H65',groundC=20,launchM=300,maximumM=3000),
                pointsExact={str(i):[str(v) for v in p] for i,p in enumerate((P1,P2,P3,P4),1)},
                replay=dict(verticalCubic=[[str(v) for v in p] for p in VERTICAL],
                            parallelAnnotationCubic=[[str(v) for v in p] for p in TRANSPORT],
                            outputLine=[[str(v) for v in p] for p in (P3,P4)]),
                steps=[dict(step=1,prescribed='20 C vertical to the 300 m curve',
                            reproduced='Published green path P1 to P2',
                            derivation='REFUSED_300M_CURVE_NOT_PUBLISHED'),
                       dict(step=2,prescribed='Parallel to ISA until the 3000 m curve',
                            reproduced='Published green cubic P2 to P3',
                            derivation='REFUSED_CONTINUOUS_ISA_AND_DISPLACEMENT_RULE_NOT_DEFINED'),
                       dict(step=3,prescribed='Horizontal from intersection to the lift axis',
                            reproduced='Published horizontal P3 to P4',
                            derivation='P3_NOT_EXACTLY_ON_3000M_FILLED_CONTOUR')],
                annotatedFirstLegDeltaXExact=str(P2[0]-P1[0]),
                launchIntersectionEvidence=dict(
                    seaLevelYAtP2XExact=list(map(str,sea)),
                    altitude1000mYAtP2XExact=list(map(str,thousand)),
                    p2BetweenTheseCurves=True,altitude300mIntersectionCertified=False),
                actual3000mInkBoundaryCrossings=intersections,
                blackOutlineAtP3XExact=[str(black_lo),str(black_hi)],
                publishedReadoutKgPer1000Ft3='6.55',
                exactProductOfPublishedReadoutAndNominalVolumeKg='425.75',
                publishedTotalLiftKg=426,
                existingDocumentaryInkInterval=known['liftKgPer1000Ft3Interval'],
                discrepancies='No snapping of P3, fitted ISA, interpolation at 300 m or inferred rounding rule',
                reconstructedIsaTransport=False,activation=False,admissibleLoad=False)


def main():
    try:
        content=fm.extract(fm.MANUAL)
        result=dict(case20C=replay(content),case10C=replay(content,'10'))
    except (fm.Refused,OSError) as error:
        result=dict(status='REFUSED',reason=str(error),activation=False,admissibleLoad=False)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
