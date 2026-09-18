import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenAipAltitudeLimit as n, calculateAirspaceVerticalContext as c, airspaceVerticalNotice } from "./airspaceAltitude.ts";
const sfc=n({value:0,unit:1,referenceDatum:0});
const floor=n({value:100,unit:0,referenceDatum:1});
const ceiling=n({value:2500,unit:1,referenceDatum:1});
test("AMSL ft→m converts the limit, not the pilot datum",()=>{
 assert.equal(ceiling.metersAMSL,762);assert.equal(ceiling.comparability,"COMPARABLE");
 assert.equal(c(floor,ceiling,500,10).state,"UNKNOWN");
 assert.equal(c(floor,ceiling,500,10).distanceToCeilingMeters,null);
});
for(const [raw,label,reference] of [[{value:1500,unit:1,referenceDatum:0},"1500 ft AGL","AGL"],[{value:65,unit:6,referenceDatum:2},"FL 065","FL"],[{value:0,unit:1,referenceDatum:0},"SFC","SFC"]])test(`${reference} preserves published reference without conversion`,()=>{
 const limit=n(raw);assert.equal(limit.displayLabel,label);assert.deepEqual(limit.raw,raw);assert.equal(limit.metersAMSL,null);assert.equal(limit.comparability,"NOT_COMPARABLE");assert.equal(c(limit,ceiling,500,10,"AMSL").state,"UNKNOWN");
});
for(const raw of [{value:1000,unit:1,referenceDatum:99},{value:1000,unit:99,referenceDatum:1},{value:Infinity,unit:1,referenceDatum:1},{value:NaN,unit:1,referenceDatum:1}])test(`unknown published limit ${String(raw.value)}/${raw.unit}/${raw.referenceDatum}`,()=>{
 const limit=n(raw);assert.deepEqual(limit.raw,raw);assert.equal(limit.comparability,"UNKNOWN");assert.equal(limit.metersAMSL,null);assert.doesNotMatch(limit.displayLabel,/STD/);assert.match(limit.displayLabel,new RegExp(String(raw.value)));assert.equal(c(limit,ceiling,500,10,"AMSL").state,"UNKNOWN");
});
for(const altitude of [750,763,762])test(`ceiling uncertainty at ${altitude}±30 stays unknown`,()=>assert.equal(c(floor,ceiling,altitude,30,"AMSL").state,"UNKNOWN"));
for(const accuracy of [null,undefined,-1,NaN,Infinity])test(`unusable accuracy ${accuracy} never defaults to zero`,()=>assert.equal(c(floor,ceiling,800,accuracy,"AMSL").state,"UNKNOWN"));
test("demonstrated AMSL interval allows certain separation/interior",()=>{
 assert.equal(c(floor,ceiling,50,10,"AMSL").state,"BELOW");assert.equal(c(floor,ceiling,800,10,"AMSL").state,"ABOVE");assert.equal(c(floor,ceiling,500,10,"AMSL").state,"INSIDE");
 assert.equal(c(floor,ceiling,100,0,"AMSL").state,"UNKNOWN");
 assert.equal(c(floor,ceiling,null,10,"AMSL").state,"UNKNOWN");
});
test("SFC never yields measured floor or confirmed interior",()=>{
 const context=c(sfc,ceiling,500,10,"AMSL");assert.equal(context.state,"UNKNOWN");assert.equal(context.distanceToFloorMeters,null);assert.equal(context.isFloorComparable,false);
});
test("UI explains unknown and non-comparable references",()=>{
 assert.match(airspaceVerticalNotice(null,ceiling.raw),/inconnue/);assert.match(airspaceVerticalNotice(sfc.raw,ceiling.raw),/non comparable/);
});

test("cached published limits remain readable offline without conversion",async()=>{
 const {MemoryAirspaceCache}=await import("./airspaceCache.ts");const cache=new MemoryAirspaceCache();
 const limits=[{value:1500,unit:1,referenceDatum:0},{value:65,unit:6,referenceDatum:2},{value:1000,unit:99,referenceDatum:99}];
 await cache.put({tileId:"offline",schemaVersion:1,fetchedAt:0,airspaces:limits.map(lowerLimit=>({properties:{lowerLimit}}))});
 const stored=await cache.get("offline");
 for(const [index,feature] of stored.airspaces.entries()){
 const limit=n(feature.properties.lowerLimit);assert.deepEqual(limit.raw,limits[index]);assert.notEqual(limit.displayLabel,"—");assert.equal(limit.metersAMSL,null);
 }
});
test("invalid AMSL bounds cannot establish separation",()=>assert.equal(c(ceiling,floor,800,10,"AMSL").state,"UNKNOWN"));
