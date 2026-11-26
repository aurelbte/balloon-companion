import test from 'node:test';
import assert from 'node:assert/strict';
import {moroccoReferenceDraftEdited, moroccoDossierOpeningReference, resolveMoroccoDossierReference as resolve} from './moroccoDossierReference.ts';
const preparation={startedAt:'2026-11-05T23:30:45Z',launchTimeZone:'Africa/Casablanca'};

test('reference is prefilled in flight local time, independent of host/browser zone and wall clock',()=>{
  const r=resolve(preparation);assert.equal(r.date,'2026-11-06');assert.equal(r.time,'00:30');assert.equal(r.iso,'2026-11-05T23:30:00.000Z');assert.equal(r.dateLabel,'06/11/2026');assert.equal(r.timeZone,'Africa/Casablanca');assert.equal(r.warning,null);
});
test('edited civil reference resolves in the preparation zone, without mutating any flight timestamp',()=>{
  const before=JSON.stringify(preparation);const r=resolve(preparation,{date:'2026-11-12',time:'08:15'});assert.equal(r.iso,'2026-11-12T07:15:00.000Z');assert.equal(r.dateLabel,'12/11/2026');assert.equal(r.time,'08:15');assert.equal(JSON.stringify(preparation),before);
  const ramadan=resolve(preparation,{date:'2026-03-08',time:'08:15'});assert.equal(ramadan.iso,'2026-03-08T08:15:00.000Z');assert.equal(ramadan.offset,'UTC');
});
test('invalid formats, nonexistent dates/times and ambiguous edited local times are rejected',()=>{
  for(const override of [{date:'12/11/2026',time:'08:15'},{date:'2026-02-30',time:'08:15'},{date:'2026-11-12',time:'24:00'},{date:'2026-11-12',time:''}])assert.throws(()=>resolve(preparation,override),/Date/);
  const paris={startedAt:'2026-01-01T08:00:00Z',launchTimeZone:'Europe/Paris'};
  for(const date of ['2026-03-29','2026-10-25'])assert.throws(()=>resolve(paris,{date,time:'02:30'}),/inexistante ou ambiguë/);
  const exact=resolve({startedAt:'2026-10-25T01:30:00Z',launchTimeZone:'Europe/Paris'},{date:'2026-10-25',time:'02:30'});assert.equal(exact.iso,'2026-10-25T01:30:00.000Z');
});
test('missing or invalid local timezone is explicitly disclosed, with UTC fallback',()=>{
  for(const launchTimeZone of [undefined,'Not/AZone']){const r=resolve({...preparation,launchTimeZone});assert.equal(r.timeZone,'UTC');assert.ok(r.warning.includes('non renseigné'));assert.equal(r.time,'23:30');}
});

test('actual opening instant, not tomorrow takeoff; Casablanca uses IANA rules in November and Ramadan',()=>{
 const flight={startedAt:'2026-11-27T05:30:00Z',launchTimeZone:'Africa/Casablanca'},before=JSON.stringify(flight);
 const opened=moroccoDossierOpeningReference(new Date('2026-11-26T07:30:58Z'),'Africa/Casablanca');
 assert.equal(opened.date,'2026-11-26');assert.equal(opened.time,'08:30');assert.equal(opened.iso,'2026-11-26T07:30:00.000Z');
 assert.equal(resolve(flight,{date:'2026-11-27',time:'06:30'}).iso,flight.startedAt.replace('Z','.000Z'));
 assert.equal(moroccoDossierOpeningReference(new Date('2026-03-08T07:30:00Z'),'Africa/Casablanca').time,'07:30');
 assert.equal(moroccoDossierOpeningReference(new Date('2026-11-26T23:30:00Z'),'Africa/Casablanca').date,'2026-11-27');
 assert.equal(JSON.stringify(flight),before);
});

test('legacy manual references are migrated without resetting them to the new wall clock',()=>{
 const oldDefault=resolve(preparation);
 assert.equal(moroccoReferenceDraftEdited(oldDefault,preparation),false);
 assert.equal(moroccoReferenceDraftEdited({date:'2026-11-10',time:'08:30'},preparation),true);
 assert.equal(moroccoReferenceDraftEdited({...oldDefault,referenceEdited:true},preparation),true);
 assert.equal(moroccoReferenceDraftEdited({date:'2026-11-10',time:'08:30',referenceEdited:false},preparation),false);
});

test('opening uses device timezone independently from the launch site; writing zone travels with manual values',()=>{
 const flight={startedAt:'2026-11-27T05:30:00Z',launchTimeZone:'Africa/Casablanca'};
 const opened=moroccoDossierOpeningReference(new Date('2026-11-26T07:30:00Z'),'America/New_York');
 assert.equal(opened.time,'02:30');assert.equal(opened.timeZone,'America/New_York');
 const edited=resolve(flight,{date:'2026-11-01',time:'08:30',timeZone:'Asia/Tokyo'});
 assert.equal(edited.iso,'2026-10-31T23:30:00.000Z');assert.equal(edited.timeZone,'Asia/Tokyo');
 assert.equal(flight.startedAt,'2026-11-27T05:30:00Z');
 assert.throws(()=>resolve(flight,{date:'2026-11-01',time:'08:30',timeZone:'Invalid/Zone'}),/Fuseau/);
});
