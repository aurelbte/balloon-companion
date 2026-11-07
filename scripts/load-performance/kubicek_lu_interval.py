"""Offline graduated PDF geometric enclosures. Never an operational load result.
Exact rationals, no empirical tolerance and no writes to datasets/activation.
Every printed altitude/integer-temperature pair is enclosed or explicitly refused.
"""
from dataclasses import dataclass
from fractions import Fraction as Q
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

from kubicek_pdf_content import extract_page69_content

ROOT = Path(__file__).resolve().parents[2]
SOURCES = {
    'c32dd501b7761b1b03974aa8e39b6d4e20efc9e304c1a520ecc37c03bf721c30': 'B3102 Ed.3 Rev.22, p.5-3 Rev.17',
    'acf9540b314a9060b68c8006c76ad7790a8eaf97bf695f59c9f84bac11ab2410': 'B3102 Ed.3 Rev.23, p.5-3 Rev.17',
}
ALTITUDES = (0,1500,3000,4500,6000,8000,10000,12500,15000,17500,20000,22500,25000,27500,30000)

CURVE_TRANSLATIONS = dict(zip(ALTITUDES, (
    '-340.7686','-269.5507','-198.2135','-137.6126','-77.0118',
    '-9.7306','57.5507','124.5933','191.5167','244.0056','296.3752',
    '337.8892','379.2838','411.1351','445.3721')))

class Refused(ValueError):
    pass

def require(condition, reason):
    if not condition:
        raise Refused(reason)

@dataclass(frozen=True)
class Interval:
    lo: Q
    hi: Q

    def __post_init__(self):
        require(self.lo <= self.hi, 'REVERSED_INTERVAL')

    def pad(self, radius):
        require(radius >= 0, 'INVALID_STROKE_RADIUS')
        return Interval(self.lo-radius, self.hi+radius)

    def report(self):
        # Outward decimal conversion by integer division: display cannot narrow the proof.
        scale = 10**12
        def text(n):
            sign = '-' if n < 0 else ''
            n = abs(n)
            return f'{sign}{n//scale}.{n%scale:012d}'
        return [text((self.lo*scale).__floor__()), text((self.hi*scale).__ceil__())]


def bezier(points, t):
    """de Casteljau in Q: exact arithmetic, no floating error or stopping tolerance."""
    current = points
    while len(current) > 1:
        current = [tuple((1-t)*a[j]+t*b[j] for j in (0,1)) for a,b in zip(current,current[1:])]
    return current[0]


def crossing(segments, y_band, radius, steps=48):
    require(steps >= 1, 'INVALID_SUBDIVISION_BUDGET')
    require(bool(segments), 'MISSING_CURVE')
    # A continuous, strictly y-monotone chain gives exactly one centreline crossing
    # for every y in the band. Refuse folds, gaps and tangency/flat ambiguities.
    for index, points in enumerate(segments):
        require(len(points) in (2,4), 'UNSUPPORTED_CURVE')
        require(all(a[1] < b[1] for a,b in zip(points,points[1:])), 'NON_MONOTONE_Y')
        require(all(a[0] <= b[0] for a,b in zip(points,points[1:])), 'NON_MONOTONE_X')
        if index:
            require(segments[index-1][-1] == points[0], 'DISCONNECTED_CURVE')
    target = y_band.pad(radius)  # Entire round stroke, not just its centreline.
    require(segments[0][0][1] <= target.lo and target.hi <= segments[-1][-1][1], 'CURVE_ENDPOINT_OR_CLIP_UNCERTAIN')
    bounds = []
    for points in segments:
        if points[-1][1] < target.lo or points[0][1] > target.hi:
            continue
        def bracket(y):
            if y <= points[0][1]: return Q(0),Q(0)
            if y >= points[-1][1]: return Q(1),Q(1)
            lo,hi = Q(0),Q(1)
            for _ in range(steps):
                mid=(lo+hi)/2
                if bezier(points,mid)[1] < y: lo=mid
                else: hi=mid
            return lo,hi
        low = bracket(target.lo)[0]
        high = bracket(target.hi)[1]
        # Monotone x controls certify this interval, even with a finite budget.
        bounds.append(Interval(bezier(points,low)[0],bezier(points,high)[0]))
    require(bool(bounds), 'NO_INTERSECTION')
    return Interval(min(b.lo for b in bounds),max(b.hi for b in bounds)).pad(radius)


def block(content, tx, ty):
    pattern = rf'^q\s+1 0 0 1 {re.escape(tx)} {re.escape(ty)} cm\n(.*?)\nS\nQ'
    found = list(re.finditer(pattern,content,re.M|re.S))
    require(len(found)==1, 'AMBIGUOUS_PRIMITIVE')
    return found[0]


def moves(match, tx, ty):
    return [(Q(x)+Q(tx),Q(y)+Q(ty)) for x,y in re.findall(r'^([-\d.]+) ([-\d.]+) m$',match[1],re.M)]


def calibrate_axes(content):
    # Scope is hash-pinned; these command bindings/labels are the previously
    # reviewed graph. No inference from sorting unlabeled paths or fitting samples.
    require('0.239 w 1 j \n/GS2 gs' in content, 'UNSUPPORTED_AXIS_STYLE')
    axis_radius=Q('0.239')/2
    bottom=moves(block(content,'489.7491','103.103'),'489.7491','103.103')
    top=moves(block(content,'489.7491','720.2056'),'489.7491','720.2056')
    grid=moves(block(content,'462.1924','105.6082'),'462.1924','105.6082')
    require(len(bottom)==14 and len(top)==14 and len(grid)==13, 'AXIS_TICK_COUNT')
    lu_ticks={}
    for i in range(14):
        coordinates=[bottom[i][0],top[i][0]] + ([grid[i-1][0]] if i else [])
        # Hull all corresponding grid/tick positions; do not assume an exact
        # affine calibration through their slightly different coordinates.
        lu_ticks[10+i]=Interval(min(coordinates),max(coordinates)).pad(axis_radius)
    require(all(lu_ticks[k+1].hi < lu_ticks[k].lo for k in range(10,23)), 'AXIS_ORDER_AMBIGUOUS')
    temperatures=moves(block(content,'489.6298','105.6082'),'489.6298','105.6082')
    require(len(temperatures)==92, 'TEMPERATURE_TICK_COUNT')
    minor,major=temperatures[:76],temperatures[76:]
    require(all(a[1]<b[1] for a,b in zip(minor,minor[1:])), 'TEMPERATURE_ORDER_AMBIGUOUS')
    require(minor[0][1]==Q('105.6082') and minor[-1][1]==Q('722.7112'), 'TEMPERATURE_ENDPOINT_MISMATCH')
    # Major tick and horizontal-grid positions are also included, rather than
    # assuming they agree exactly with the minor graduations.
    horizontal = list(re.finditer(
        r'^q 1 0 0 1 131\.6316 105\.6082 cm\n(.*?)\nS\nQ', content, re.M|re.S))
    grids = [moves(m,'131.6316','105.6082') for m in horizontal]
    grids = [g for g in grids if len(g)==15]
    require(len(grids)==1, 'HORIZONTAL_GRID_AMBIGUOUS')
    require(len(major)==16, 'MAJOR_TEMPERATURE_TICK_COUNT')
    bands={}
    for i in range(76):
        coordinates=[minor[i][1]]
        if i%5==0:
            coordinates.append(major[i//5][1])
            if i//5 < 15: coordinates.append(grids[0][i//5][1])
        bands[i-40]=Interval(min(coordinates),max(coordinates)).pad(axis_radius)
    require(all(bands[t].hi < bands[t+1].lo for t in range(-40,35)),
            'TEMPERATURE_BAND_ORDER_AMBIGUOUS')
    return bands,lu_ticks


def parse_curve(content,altitude):
    require(altitude in CURVE_TRANSLATIONS,'UNKNOWN_ALTITUDE_GRADUATION')
    translation=CURVE_TRANSLATIONS[altitude]
    curve=block(content,translation,'27.4713')
    prefix=content[:curve.start()]
    clip=re.search(r'q\n([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re\nW n\n0 0 0 RG\n0.954 w 1 J \n$',prefix)
    inherited=None
    if altitude==12500 and clip is None:
        # The 12500-ft path immediately follows the 8000-ft local q/S/Q,
        # inside the SAME enclosing clip/style q. No intervening operator may
        # alter state. Reuse only that explicitly checked inherited state.
        sibling=block(content,CURVE_TRANSLATIONS[8000],'27.4713')
        require(sibling.end() < curve.start() and
                not content[sibling.end():curve.start()].strip(),
                'INHERITED_CURVE_STATE_AMBIGUOUS')
        _,inherited_radius,inherited_clip=parse_curve(content,8000)
        inherited=(inherited_radius,inherited_clip)
    require(clip is not None or inherited is not None, 'UNSUPPORTED_CURVE_STYLE_OR_CLIP')
    # Verify no unaccounted parent CTM remains at this curve. Local translations
    # are the only cm supported in this pinned content (text Tm is not a CTM).
    stack=[]; translated=False
    for line in prefix.splitlines():
        if re.match(r'^q(?:\s|$)',line): stack.append(translated)
        if re.search(r'\bcm$',line): translated=True
        if line=='Q':
            require(bool(stack),'UNBALANCED_GRAPHICS_STATE')
            translated=stack.pop()
    require(not translated,'UNACCOUNTED_PARENT_TRANSFORM')
    tx,ty=Q(translation),Q('27.4713')
    segments=[]; previous=None
    for line in curve[1].splitlines():
        parts=line.split(); op=parts[-1] if parts else ''
        require(op in ('m','l','c'),'UNSUPPORTED_PATH_OPERATOR')
        numbers=list(map(Q,parts[:-1]))
        require(len(numbers)=={'m':2,'l':2,'c':6}[op], 'MALFORMED_PATH')
        points=[(numbers[i]+tx,numbers[i+1]+ty) for i in range(0,len(numbers),2)]
        if op=='m':
            require(previous is None,'MULTIPLE_SUBPATHS')
        else:
            require(previous is not None,'MISSING_MOVETO')
            segments.append([previous,*points])
        previous=points[-1]
    radius=Q('0.954')/2  # Explicit round joins/caps; inherited state checked by extractor.
    if inherited is not None:
        radius,rectangle=inherited
    else:
        rectangle=tuple(map(Q,clip.groups()))
    return segments,radius,rectangle


def enclose_pair(curve,temperature_band,ticks):
    segments,radius,(x,y,w,h)=curve
    x_band=crossing(segments,temperature_band,radius)
    require(x < x_band.lo and x_band.hi < x+w and y < temperature_band.lo-radius
            and temperature_band.hi+radius < y+h,'CLIP_INTERSECTS_PROOF_BAND')
    return x_band,bound_from_ticks(x_band,ticks)


def qualify_geometry(content,altitude=6000,temperature=6):
    bands,ticks=calibrate_axes(content)
    x_band,_=enclose_pair(parse_curve(content,altitude),bands[temperature],ticks)
    return x_band,bands[temperature],ticks


def bound_from_ticks(x_band,ticks):
    # LU increases to the left. Strict separation from whole ink bands proves
    # integer bounds without sub-tick interpolation or any empirical epsilon.
    lower=[k for k,band in ticks.items() if x_band.hi < band.lo]
    upper=[k for k,band in ticks.items() if band.hi < x_band.lo]
    require(lower and upper,'OUTSIDE_10_23_OR_AXIS_AMBIGUOUS')
    result=Interval(Q(max(lower)),Q(min(upper)))
    require(Q(10)<=result.lo<=result.hi<=Q(23),'OUTSIDE_10_23')
    return result


def certify(manual,altitude_ft,ground_c,launch_ft='0'):
    digest=hashlib.sha256(manual.read_bytes()).hexdigest()
    require(digest in SOURCES,'UNREVIEWED_PDF')
    h,t0,h0=map(Q,(altitude_ft,ground_c,launch_ft))
    require(0<=h0<=h<=30000,'OUTSIDE_ALTITUDE_DOMAIN')
    # Exact 0.3048 m/ft and 0.0065 C/m. Compute T at REAL h, never at h+.
    temperature=t0-Q('0.0065')*(h-h0)*Q('0.3048')
    require(-40<=temperature<=35,'OUTSIDE_TEMPERATURE_DOMAIN')
    h_plus=next(z for z in ALTITUDES if z>=h)
    t_plus=temperature.__ceil__()
    try:
        content=extract_page69_content(manual)
    except subprocess.SubprocessError as error:
        raise Refused('PDF_EXTRACTION_OR_GRAPHICS_STATE_UNSUPPORTED') from error
    x_band,t_band,ticks=qualify_geometry(content,h_plus,t_plus)
    lu=bound_from_ticks(x_band,ticks)
    return dict(status='PDF_GEOMETRY_ENCLOSED_NOT_OPERATIONALLY_VALIDATED',sourceSha256=digest,
                source=SOURCES[digest], actualAltitudeFt=str(h), temperatureAtActualAltitudeC=str(temperature),
                upperAltitudeFt=h_plus,upperTemperatureC=t_plus,curveX=x_band.report(),
                temperatureTickY=t_band.report(),luInterval=[str(lu.lo),str(lu.hi)],lowerLiftUnits=str(lu.lo),
                arithmetic='Exact decimal-to-rational parsing and rational de Casteljau; outward display bounds',
                calibration='Whole printed integer tick/grid ink bands; no affine fit or fractional LU calibration',
                scope='Pinned PDF path and round-stroke geometry only; monotonic conservative extension from p.5-1. Not a manufacturer accuracy or aircraft certificate.',
                activation=False)


def coverage(manual):
    """All 15 x 76 printed pairs, including clipped/out-of-domain refusals."""
    digest=hashlib.sha256(manual.read_bytes()).hexdigest()
    require(digest in SOURCES,'UNREVIEWED_PDF')
    content=extract_page69_content(manual)
    bands,ticks=calibrate_axes(content)
    rows=[]
    for altitude in ALTITUDES:
        try:
            curve=parse_curve(content,altitude)
            curve_error=None
        except Refused as error:
            curve_error=str(error)
        for temperature in range(-40,36):
            row=dict(altitudeFt=altitude,temperatureC=temperature)
            try:
                require(curve_error is None,curve_error)
                x,lu=enclose_pair(curve,bands[temperature],ticks)
                row.update(status='ENCLOSED',lowerLiftUnits=str(lu.lo),
                           luInterval=[str(lu.lo),str(lu.hi)],curveX=x.report(),
                           temperatureTickY=bands[temperature].report())
            except Refused as error:
                row.update(status='REFUSED',reason=str(error))
            rows.append(row)
    return dict(sourceSha256=digest,source=SOURCES[digest],pdfPage=69,
                status='PDF_GEOMETRY_ONLY_NOT_OPERATIONALLY_VALIDATED',
                activation=False, pairs=rows)


def compare_coverage(first,second):
    require(len(first['pairs'])==1140 and len(second['pairs'])==1140,'INCOMPLETE_COVERAGE')
    differences=[]
    for a,b in zip(first['pairs'],second['pairs']):
        require((a['altitudeFt'],a['temperatureC'])==(b['altitudeFt'],b['temperatureC']),
                'PAIR_ORDER_MISMATCH')
        if a!=b: differences.append(dict(first=a,second=b))
    return dict(comparedPairs=1140,identical=not differences,differences=differences)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manual',type=Path,default=ROOT/'.load-performance-work/manuals/kubicek-b3102-rev22.pdf')
    parser.add_argument('--altitude-ft',default='5500')
    parser.add_argument('--ground-c',default='16.7')
    parser.add_argument('--launch-ft',default='0')
    parser.add_argument('--coverage',action='store_true')
    parser.add_argument('--compare-manual',type=Path)
    args=parser.parse_args()
    try:
        if args.coverage:
            first=coverage(args.manual)
            result=dict(manuals=[first])
            if args.compare_manual:
                second=coverage(args.compare_manual)
                result['manuals'].append(second)
                result['comparison']=compare_coverage(first,second)
        else:
            result=certify(args.manual,args.altitude_ft,args.ground_c,args.launch_ft)
    except (Refused,ValueError,ArithmeticError,OSError) as error:
        result=dict(status='REFUSED',reason=str(error),activation=False)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
