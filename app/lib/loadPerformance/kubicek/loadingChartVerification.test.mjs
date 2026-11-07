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


test("713 nœuds LU inchangés et interpolation en température exactement pondérée sans arrondi",()=>{
  for(const p of source.points) {
    assert.equal(lookupKubicekLiftUnits(p.altitudeMslFt*0.3048,p.temperatureC),p.liftUnits);
    const next=source.points.find((q)=>q.altitudeMslFt===p.altitudeMslFt && q.temperatureC===p.temperatureC+1);
    if(!next) continue;
    for(const weight of [0.25,0.5,0.75]) {
      const actual=lookupKubicekLiftUnits(p.altitudeMslFt*0.3048,p.temperatureC+weight);
      assert.equal(actual,p.liftUnits+(next.liftUnits-p.liftUnits)*weight);
      assert.ok(actual>=Math.min(p.liftUnits,next.liftUnits) && actual<=Math.max(p.liftUnits,next.liftUnits));
    }
  }
});
test("interpolation d'altitude entre sept points déjà vérifiés : pondération exacte, pas de certification implicite",()=>{
  const altitudes=[...new Set(source.points.map((p)=>p.altitudeMslFt))].sort((a,b)=>a-b);
  for(const p of audit.checks) {
    const nextAltitude=altitudes[altitudes.indexOf(p.altitudeMslFt)+1];
    if(nextAltitude===undefined) continue;
    const next=source.points.find((q)=>q.altitudeMslFt===nextAltitude && q.temperatureC===p.temperatureC);
    if(!next) continue;
    const meters=(p.altitudeMslFt*0.3048+nextAltitude*0.3048)/2;
    const actualWeight=(meters/0.3048-p.altitudeMslFt)/(nextAltitude-p.altitudeMslFt);
    assert.equal(lookupKubicekLiftUnits(meters,p.temperatureC),p.liftUnits+(next.liftUnits-p.liftUnits)*actualWeight);
  }
  assert.equal(audit.validationStatus,"PENDING_MANUFACTURER_PRECISION_VALIDATION");
});
test("écarts fractionnaires mesurés sur les sept segments PDF indépendants, sans tolérance fabricant inventée",()=>{
  const a=audit.axes;
  const differences=[];
  for(const p of audit.checks) {
    for(const t of [0.25,0.5,0.75]) {
      const [x,y]=point(p.pdfSegment,t);
      const temperature=-40+(y-a.minus40CY)*75/(a.plus35CY-a.minus40CY);
      const direct=10+(a.lu10X-x)*13/(a.lu10X-a.lu23X);
      const interpolated=lookupKubicekLiftUnits(p.altitudeMslFt*0.3048,temperature);
      assert.notEqual(interpolated,null);
      differences.push(Math.abs(interpolated-direct));
    }
  }
  assert.equal(differences.length,21);
  assert.ok(differences.every(Number.isFinite));
  // Observed regression value, not an approved operational error tolerance.
  assert.equal(Math.max(...differences), 0.003489400791625741);
});
