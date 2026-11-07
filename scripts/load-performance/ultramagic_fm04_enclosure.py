"""Offline FM04 documentary reading and explicit transport refusals: exact ink enclosure, never a load clearance."""
from fractions import Fraction as Q
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]
MANUAL=ROOT/'.load-performance-work/manuals/ultramagic-fm04-rev30.pdf'
SHA='b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab'

class Refused(ValueError):
    pass

def require(ok,reason):
    if not ok: raise Refused(reason)

SWIFT=r'''
import CoreGraphics
import Foundation
let d=CGPDFDocument(URL(fileURLWithPath:CommandLine.arguments[1]) as CFURL)!
var r:CGPDFDictionaryRef?; var x:CGPDFDictionaryRef?; var s:CGPDFStreamRef?
guard CGPDFDictionaryGetDictionary(d.page(at:42)!.dictionary!,"Resources",&r),
      CGPDFDictionaryGetDictionary(r!,"XObject",&x),
      CGPDFDictionaryGetStream(x!,"Meta159",&s) else { fatalError("Missing chart form") }
var f=CGPDFDataFormat.raw
print(String(data:CGPDFStreamCopyData(s!,&f)! as Data,encoding:.isoLatin1)!)
'''

def extract(manual):
    require(hashlib.sha256(manual.read_bytes()).hexdigest()==SHA,'UNREVIEWED_PDF')
    return subprocess.check_output(['swift','-module-cache-path',
        '/private/tmp/bc-pdf-audit-swift-cache','-e',SWIFT,str(manual)],text=True)


def split(points):
    """Exact midpoint de Casteljau; the control hull contains the ENTIRE segment."""
    levels=[points]
    while len(levels[-1])>1:
        levels.append([tuple((a[j]+b[j])/2 for j in (0,1))
                       for a,b in zip(levels[-1],levels[-1][1:])])
    return [row[0] for row in levels],[row[-1] for row in reversed(levels)]


def column_hull(segments,xlo,xhi,depth=24):
    require(xlo<=xhi and depth>=0,'INVALID_COLUMN_OR_BUDGET')
    boxes=[]
    def visit(points,budget):
        xs=[p[0] for p in points]; ys=[p[1] for p in points]
        if max(xs)<xlo or min(xs)>xhi: return
        if budget==0 or (xlo<=min(xs) and max(xs)<=xhi):
            boxes.append((min(ys),max(ys)))
        else:
            left,right=split(points)
            visit(left,budget-1);visit(right,budget-1)
    for segment in segments: visit(segment,depth)
    require(bool(boxes),'NO_BOUNDARY_ENCLOSURE')
    # Include all boundaries, not an arbitrarily selected crossing. A compact
    # filled polygon's vertical section lies between its extreme boundaries.
    return min(p[0] for p in boxes),max(p[1] for p in boxes)


def prove_example(content,ground_c='20',launch_m='300',maximum_m='3000',volume_1000ft3='65'):
    require(tuple(map(Q,(ground_c,launch_m,maximum_m,volume_1000ft3)))==
            (Q(20),Q(300),Q(3000),Q(65)),'ONLY_DOCUMENTED_H65_20C_EXAMPLE')
    require(not re.search(r'\bcm\b',content),'UNSUPPORTED_FORM_TRANSFORM')
    # Seven clipped renderings of the SAME filled 3000-m outline, identified
    # against p.5.3 labels. Do not replace filled contours with a fitted centreline.
    polygons=re.findall(r'67\.397 1032\.23 m\n(.*?)\nh\nf',content,re.S)
    require(len(polygons)==7 and len(set(polygons))==1,'AMBIGUOUS_3000M_OUTLINE')
    previous=(Q('67.397'),Q('1032.23')); start=previous; segments=[]
    for line in polygons[0].splitlines():
        parts=line.split();require(parts[-1]=='c' and len(parts)==7,'UNSUPPORTED_OUTLINE')
        n=list(map(Q,parts[:-1]));points=[(n[i],n[i+1]) for i in (0,2,4)]
        segments.append([previous,*points]);previous=points[-1]
    require(previous==start,'UNCLOSED_OUTLINE')
    # The published green construction, NOT a numerical reconstruction of ISA.
    annotation='''2.3622 w
0.0863 0.769 0.0314 RG

495.5 66.823 m
495.79 381.14 495.79 381.14 495.79 381.14 c
468.31 376.12 422.76 346.87 385.21 315.57 c
S

385.21 315.57 m
66.216 315.57 l
S'''
    require(content.count(annotation)==1,'ANNOTATED_EXAMPLE_MISSING_OR_AMBIGUOUS')
    radius=Q('2.3622')/2
    xlo,xhi=Q('385.21')-radius,Q('385.21')+radius
    require(start[0]<xlo and any(segment[-1][0]>xhi for segment in segments),
            'NO_PROVEN_COLUMN_CROSSING')
    lo,hi=column_hull(segments,xlo,xhi)
    # Include the whole horizontal example stroke as well as the black contour.
    lo=min(lo,Q('315.57')-radius);hi=max(hi,Q('315.57')+radius)
    # Explicit filled calibration bands: 6.5 and 7.0, no affine axis or rounding.
    for top,bottom in [('309.96','308.78'),('370.51','369.33')]:
        band=f'66.216 {top} m\n617.89 {top} l\n617.89 {bottom} l\n66.216 {bottom} l'
        require(content.count(band)==6,'GRID_BAND_MISSING_OR_AMBIGUOUS')
    require(Q('309.96')<lo<=hi<Q('369.33'),'INK_NOT_SEPARATED_FROM_6_5_AND_7')
    # Use the actual strip containing both the annotation and the outline. Its
    # saved clip encloses the whole proof band; no extrapolation through clipping.
    require('66.216 232.84 553.15 144.46 re\nW n' in content,'MISSING_REVIEWED_CLIP')
    require(Q('66.216')<xlo<xhi<Q('619.366') and
            Q('232.84')<lo<=hi<Q('377.30'),'CLIP_INTERSECTS_PROOF_BAND')
    return dict(status='DOCUMENTARY_EXAMPLE_GEOMETRY_ONLY',sourceSha256=SHA,
                pages='5.3 Rev.23 / 5.5 Rev.25 (PDF 42 / 44)',
                input=dict(model='H65',groundC=20,launchM=300,maximumM=3000,nominalVolume1000Ft3=65),
                outlineYExact=[str(lo),str(hi)],
                liftKgPer1000Ft3Interval=['6.5','7'],lowerLiftKgPer1000Ft3='6.5',
                nominalTotalLiftLowerKg='422.5',publishedExampleLiftKgPer1000Ft3='6.55',
                arithmetic='Exact rational control hulls; retained subdivision remainder; no empirical tolerance',
                scope='Only the published annotated H65 construction; no general ISA transport or physical accuracy proof',
                activation=False,admissibleLoad=False)


# Explicitly identified solid altitude contours and reviewed duplicate counts.
ALTITUDE_OUTLINES={0:('1704.86',7),1000:('1458.21',7),2000:('1234.59',7),
    3000:('1032.23',7),4000:('849.97',7),5000:('685.72',7),
    6000:('538.6',5),7000:('406.56',4)}
# Whole major vertical grid bands, not a fitted coordinate transformation.
TEMPERATURE_GRID={-40:('127.12','128'),-30:('188.31','189.49'),
    -20:('249.51','250.69'),-10:('311.02','311.91'),0:('372.22','373.40'),
    10:('433.42','434.60'),20:('494.91','495.79'),30:('556.10','557.28')}
LIFT_GRID={Q('5'):('126.79','127.97'),Q('5.5'):('187.66','188.55'),
    Q('6'):('248.22','249.11'),Q('6.5'):('308.78','309.96'),
    Q('7'):('369.33','370.51'),Q('7.5'):('429.89','431.07'),
    Q('8'):('490.74','491.63'),Q('8.5'):('551.30','552.48'),
    Q('9'):('611.85','613.03'),Q('9.5'):('672.41','673.59')}


def render_clips(content,positions):
    """Track the axis-aligned clipping q/Q stack of this hash-pinned Form.

    Reject a nonrectangular W or any unbalanced state, rather than attributing
    a nearest textual rectangle to an outline with an unrelated active clip.
    """
    result={}; stack=[]; clip=None; pending=None; offset=0
    positions=set(positions)
    for line in content.splitlines(keepends=True):
        if offset in positions: result[offset]=clip
        op=line.strip()
        if op=='q': stack.append(clip)
        elif op=='Q':
            require(bool(stack),'UNBALANCED_GRAPHICS_STATE')
            clip=stack.pop();pending=None
        elif op.endswith(' re'):
            parts=op.split();require(len(parts)==5,'UNSUPPORTED_CLIP_RECTANGLE')
            x,y,w,h=map(Q,parts[:4]);require(w>0 and h>0,'INVALID_CLIP_RECTANGLE')
            pending=(x,y,x+w,y+h)
        elif op in ('W n','W* n'):
            require(pending is not None,'NON_RECTANGULAR_CLIP_UNSUPPORTED')
            if clip is None: clip=pending
            else: clip=(max(clip[0],pending[0]),max(clip[1],pending[1]),
                        min(clip[2],pending[2]),min(clip[3],pending[3]))
            pending=None
        elif op: pending=None
        offset+=len(line)
    require(not stack,'UNBALANCED_GRAPHICS_STATE')
    require(len(result)==len(positions),'MISSING_OUTLINE_CLIP')
    return result


def prepare_direct_geometry(content):
    require(not re.search(r'\bcm\b',content),'UNSUPPORTED_FORM_TRANSFORM')
    curves={}; occurrences={}
    for altitude,(y,count) in ALTITUDE_OUTLINES.items():
        matches=list(re.finditer(r'67\.397 '+re.escape(y)+r' m\n(.*?)\nh\nf',content,re.S))
        require(len(matches)==count and len({m[1] for m in matches})==1,
                'AMBIGUOUS_ALTITUDE_OUTLINE_'+str(altitude))
        previous=(Q('67.397'),Q(y)); start=previous; segments=[]
        for line in matches[0][1].splitlines():
            parts=line.split();require(parts[-1]=='c' and len(parts)==7,'UNSUPPORTED_OUTLINE')
            n=list(map(Q,parts[:-1]));points=[(n[i],n[i+1]) for i in (0,2,4)]
            segments.append([previous,*points]);previous=points[-1]
        require(previous==start,'UNCLOSED_OUTLINE')
        curves[altitude]=segments;occurrences[altitude]=[m.start() for m in matches]
    clips=render_clips(content,[p for positions in occurrences.values() for p in positions])
    # Verify all selected calibration rectangles, including their complete ink.
    for low,high in TEMPERATURE_GRID.values():
        # PDF decimal spellings are retained below, not Fraction strings.
        rectangles=re.findall(r'^([\d.]+) 733\.58 m\n([\d.]+) 733\.58 l',content,re.M)
        require(sum(Q(a)==Q(low) and Q(b)==Q(high) for a,b in rectangles)==6,
                'TEMPERATURE_GRID_MISSING_OR_AMBIGUOUS')
    bands=re.findall(r'^66\.216 ([\d.]+) m\n617\.89 ([\d.]+) l\n617\.89 ([\d.]+) l\n66\.216 ([\d.]+) l',content,re.M)
    for low,high in LIFT_GRID.values():
        require(sum(Q(a)==Q(b)==Q(high) and Q(c)==Q(d)==Q(low) for a,b,c,d in bands)==6,
                'LIFT_GRID_MISSING_OR_AMBIGUOUS')
    return curves,{h:[clips[p] for p in occurrences[h]] for h in curves}


def clips_cover_band(clips,xlo,xhi,ylo,yhi):
    """Union only clips rendering verified IDENTICAL copies of this outline.

    Each retained rectangle covers the whole column. Overlapping open vertical
    intervals may be joined; touching edges/gaps never manufacture coverage.
    """
    bands=sorted((c[1],c[3]) for c in clips if c is not None and c[0]<xlo<=xhi<c[2])
    end=None
    for lo,hi in bands:
        if end is None:
            if lo<ylo<hi: end=hi
        elif lo<end: end=max(end,hi)
        if end is not None and yhi<end: return True
    return False


def direct_reading(geometry,altitude,temperature):
    require(altitude in ALTITUDE_OUTLINES,'INTERMEDIATE_ALTITUDE_NOT_DEFINED')
    require(-40<=temperature<=30,'OUTSIDE_QUALIFIED_TEMPERATURE_CALIBRATION')
    low=max(t for t in TEMPERATURE_GRID if t<=temperature)
    high=min(t for t in TEMPERATURE_GRID if t>=temperature)
    # For an intermediate temperature enclose the WHOLE space between printed
    # ticks. No affine fit, interpolation, temperature-ceiling monotonicity claim.
    xlo=Q(TEMPERATURE_GRID[low][0]);xhi=Q(TEMPERATURE_GRID[high][1])
    segments=geometry[0][altitude]
    require(segments[0][0][0]<xlo and any(s[-1][0]>xhi for s in segments),
            'NO_PROVEN_COLUMN_CROSSING')
    ylo,yhi=column_hull(segments,xlo,xhi)
    require(clips_cover_band(geometry[1][altitude],xlo,xhi,ylo,yhi),
            'CLIP_INTERSECTS_PROOF_BAND')
    lower=[u for u,(lo,hi) in LIFT_GRID.items() if Q(hi)<ylo]
    upper=[u for u,(lo,hi) in LIFT_GRID.items() if yhi<Q(lo)]
    require(lower and upper,'OUTSIDE_QUALIFIED_LIFT_SCALE_OR_AXIS_AMBIGUOUS')
    return dict(status='DIRECT_PRINTED_CURVE_GEOMETRY_ONLY',
                liftKgPer1000Ft3Interval=[str(max(lower)),str(min(upper))],
                lowerLiftKgPer1000Ft3=str(max(lower)),
                temperatureXExact=[str(xlo),str(xhi)],outlineYExact=[str(ylo),str(yhi)],
                isaTransport='IDENTITY_NO_ALTITUDE_CHANGE',intermediateAltitude=False,
                activation=False,admissibleLoad=False)


def evaluate(content,ground_c,launch_m,maximum_m,geometry=None):
    """An answer or a reason for every input; no implied numerical ISA model."""
    try:
        t,h0,h1=map(Q,(str(ground_c),str(launch_m),str(maximum_m)))
    except (ValueError,ZeroDivisionError):
        return dict(status='REFUSED',reasons=['INVALID_NUMERIC_INPUT'],activation=False,admissibleLoad=False)
    record=dict(groundC=str(t),launchM=str(h0),maximumM=str(h1))
    reasons=[]
    if not (0<=h0<=h1<=7000 and -50<=t<=40): reasons=['OUTSIDE_PRINTED_DOMAIN']
    elif (t,h0,h1)==(Q(20),Q(300),Q(3000)):
        try:
            return dict(requestedInput=record,
                        isaTransport='PUBLISHED_ANNOTATION_ONLY_NOT_GENERAL_TRANSPORT_PROOF',
                        **prove_example(content))
        except Refused as error: reasons=[str(error)]
    elif h0!=h1:
        reasons=['ISA_PARALLEL_TRANSPORT_NOT_DOCUMENTARILY_ENCLOSED']
        if h0 not in ALTITUDE_OUTLINES or h1 not in ALTITUDE_OUTLINES:
            reasons.append('INTERMEDIATE_ALTITUDE_NOT_DEFINED')
    elif h0 not in ALTITUDE_OUTLINES: reasons=['INTERMEDIATE_ALTITUDE_NOT_DEFINED']
    else:
        try:
            result=direct_reading(geometry or prepare_direct_geometry(content),h0,t)
            return dict(input=record,**result)
        except Refused as error: reasons=[str(error)]
    return dict(input=record,status='REFUSED',reasons=reasons,activation=False,admissibleLoad=False)


def coverage(content):
    from collections import Counter
    geometry=prepare_direct_geometry(content)
    representatives=[evaluate(content,*case,geometry) for case in [
        (20,300,3000),(10,300,3000),(20,0,3000),(20,1000,3000),
        (20,500,3000),(20,300,3500),(20,500,500),
        (20,0,0),(0,3000,3000),(-20,7000,7000),(5,3000,3000),
        (40,7000,7000)]]
    # Explicit sample universe: 11 heights, ordered start/max pairs, 8 major
    # temperature ticks. Separately explore every integer T in qualified direct reads.
    heights=(0,300,500,1000,1500,2000,3000,4000,5000,6000,7000)
    cases=[evaluate(content,t,a,b,geometry) for a in heights for b in heights if b>=a
           for t in range(-40,31,10)]
    direct=[evaluate(content,t,h,h,geometry) for h in ALTITUDE_OUTLINES for t in range(-40,31)]
    def summary(rows):
        refused=[r for r in rows if r['status']=='REFUSED']
        return dict(total=len(rows),enclosed=len(rows)-len(refused),refused=len(refused),
                    primaryReasons=dict(Counter(r['reasons'][0] for r in refused)))
    return dict(sourceSha256=SHA,pages='5.3 Rev.23 / 5.5 Rev.25',
                scope='Geometry only; no physical accuracy, model activation or admissible load',
                certifiedGeneralIsaTransports=0,intermediateAltitudeConstructionCertified=False,
                activation=False,admissibleLoad=False,representatives=representatives,
                sampleGridSummary=summary(cases),sampleGrid=cases,
                directIntegerSummary=summary(direct),directIntegerCases=direct)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--coverage',action='store_true')
    parser.add_argument('--ground-c',default='20')
    parser.add_argument('--launch-m',default='300')
    parser.add_argument('--maximum-m',default='3000')
    args=parser.parse_args()
    try:
        content=extract(MANUAL)
        result=coverage(content) if args.coverage else evaluate(content,args.ground_c,args.launch_m,args.maximum_m)
    except (Refused,OSError,subprocess.SubprocessError) as error:
        result=dict(status='REFUSED',reasons=[str(error)],activation=False,admissibleLoad=False)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
