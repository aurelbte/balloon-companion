import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { lookupKubicekLiftUnits } from "./officialCalculation.ts";
const audit=JSON.parse(readFileSync(new URL("../datasets/audits/kubicek-b3102-ed3-rev22-loading-chart-check.json",import.meta.url),"utf8"));
const source=JSON.parse(readFileSync(new URL("../datasets/audits/kubicek-b3102-ed3-rev19-loading-chart.json",import.meta.url),"utf8"));
function point(ps,t) {
  const weights=ps.length===2 ? [1-t,t] : [(1-t)**3,3*t*(1-t)**2,3*t*t*(1-t),t**3];
  return [0,1].map((j)=>ps.reduce((sum,p,i)=>sum+weights[i]*p[j],0));
}
test("vérification indépendante locale : sept points, 15 courbes et 713 comparaisons sans tolérance constructeur inventée",()=>{
  assert.equal(audit.pageRevision,17);
  assert.equal(audit.pdfPage,69);
  assert.equal(audit.curveCount,15);
  assert.equal(audit.comparedPointCount,713);
  assert.equal(audit.checks.length,7);
  assert.equal(audit.validationStatus,"PENDING_MANUFACTURER_PRECISION_VALIDATION");
  const a=audit.axes;
  for (const check of audit.checks) {
    const y=a.minus40CY+(check.temperatureC+40)*(a.plus35CY-a.minus40CY)/75;
    let low=0,high=1;
    for(let i=0;i<60;i++) {
      const mid=(low+high)/2;
      if(point(check.pdfSegment,mid)[1]<y) low=mid; else high=mid;
    }
    const x=point(check.pdfSegment,(low+high)/2)[0];
    const lu=10+(a.lu10X-x)*13/(a.lu10X-a.lu23X);
    // Arithmetic reproducibility only, not a manufacturer acceptance threshold.
    assert.ok(Math.abs(lu-check.independentlyReadLiftUnits)<=Number.EPSILON*32);
    const original=source.points.find((p)=>p.altitudeMslFt===check.altitudeMslFt && p.temperatureC===check.temperatureC);
    assert.equal(check.liftUnits,original.liftUnits);
    assert.equal(lookupKubicekLiftUnits(check.altitudeMslFt*0.3048,check.temperatureC),original.liftUnits);
    assert.equal(check.deltaLiftUnits,check.independentlyReadLiftUnits-original.liftUnits);
  }
  assert.equal(audit.manufacturerExample.liftUnits,16.5);
  assert.equal(audit.manufacturerExample.massKg,533);
});
