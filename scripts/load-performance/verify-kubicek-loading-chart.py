"""Read-only independent check of Rev.19 LU samples against local Rev.22 p.5-3.
Requires macOS CoreGraphics/Swift. Prints an audit report; never rewrites LU data.
No numerical delta is treated as a manufacturer-approved tolerance.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
MANUAL = ROOT / '.load-performance-work/manuals/kubicek-b3102-rev22.pdf'
EXPECTED_SHA = 'c32dd501b7761b1b03974aa8e39b6d4e20efc9e304c1a520ecc37c03bf721c30'
assert hashlib.sha256(MANUAL.read_bytes()).hexdigest() == EXPECTED_SHA
from kubicek_pdf_content import extract_page69_content

content = extract_page69_content(MANUAL)
paths = []
for chunk in re.findall(r'q (.*?)\nQ', content, re.S):
    match = re.match(r'1 0 0 1 ([-\d.]+) (27.4713) cm\n0 0 m\n', chunk)
    if not match or not chunk.rstrip().endswith('S'):
        continue
    tx, ty = map(float, match.groups())
    previous = [tx, ty]
    segments = []
    for line in chunk.splitlines()[2:]:
        parts = line.split()
        if not parts or parts[-1] not in ('l', 'c'):
            continue
        values = list(map(float, parts[:-1]))
        vertices = [[values[i] + tx, values[i+1] + ty] for i in range(0, len(values), 2)]
        segments.append([previous, *vertices])
        previous = vertices[-1]
    paths.append((tx, segments))
paths.sort()
altitudes = [0,1500,3000,4500,6000,8000,10000,12500,15000,17500,20000,22500,25000,27500,30000]
assert len(paths) == len(altitudes)
# Printed axis endpoints, in PDF user coordinates (no fit to the existing JSON).
axes = dict(lu10X=489.7491, lu23X=131.6316, minus40CY=105.6082, plus35CY=722.7112)

def point(vertices, t):
    if len(vertices) == 2:
        return [vertices[0][j] + t*(vertices[1][j]-vertices[0][j]) for j in (0,1)]
    weights = [(1-t)**3, 3*t*(1-t)**2, 3*t*t*(1-t), t**3]
    return [sum(weights[i]*vertices[i][j] for i in range(4)) for j in (0,1)]

def independently_read(altitude, temperature):
    y = axes['minus40CY'] + (temperature+40)*(axes['plus35CY']-axes['minus40CY'])/75
    for segment in paths[altitudes.index(altitude)][1]:
        if segment[0][1] <= y <= segment[-1][1]:
            low, high = 0., 1.
            for _ in range(60):
                t = (low+high)/2
                if point(segment,t)[1] < y:
                    low = t
                else:
                    high = t
            x = point(segment,(low+high)/2)[0]
            lu = 10+(axes['lu10X']-x)*13/(axes['lu10X']-axes['lu23X'])
            return lu, segment
    raise ValueError((altitude, temperature))

legacy = json.loads((ROOT/'app/lib/loadPerformance/datasets/audits/kubicek-b3102-ed3-rev19-loading-chart.json').read_text())
checks = []
selected = {(0,20),(3000,0),(6000,6),(10000,-10),(15000,0),(20000,-20),(30000,-35)}
deltas = []
for sample in legacy['points']:
    altitude, temperature = sample['altitudeMslFt'], sample['temperatureC']
    value, segment = independently_read(altitude,temperature)
    delta = value-sample['liftUnits']
    deltas.append(abs(delta))
    if (altitude,temperature) in selected:
        checks.append(dict(**sample, independentlyReadLiftUnits=value, deltaLiftUnits=delta, pdfSegment=segment))
print(json.dumps(dict(
    manual='B.3102 Edition 3 Revision 22, 30 October 2025', sourceSha256=EXPECTED_SHA,
    page='5-3', pdfPage=69, pageRevision=17, pageRevisionDate='2024-05-20',
    method='Independent line/cubic intersection from local PDF content; affine axes from printed endpoints; no LU rounding',
    axes=axes, curveCount=len(paths), comparedPointCount=len(deltas), maximumAbsoluteDeltaLiftUnits=max(deltas),
    checks=checks, manufacturerExample=dict(liftUnits=16.5, massKg=533, page='5-2', pageRevision=16),
    validationStatus='PENDING_MANUFACTURER_PRECISION_VALIDATION',
    limitations=['Geometric comparison is not manufacturer certification of automated interpolation.',
                 'No acceptance tolerance or rounding rule is specified by the manufacturer.',
                 'Original LU JSON and BB20 numerical result are preserved.'],
), ensure_ascii=False, indent=2))
