import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyMoroccoPassengers,prepareMoroccoPassengers,moroccoPassengerWeight} from './moroccoPassengers.ts';

test('H=92, F=74, E=35; all thirteen unused rows stay blank, never default to H or zero',()=>{
  assert.deepEqual(['H','F','E',''].map(sex=>moroccoPassengerWeight(sex)),[92,74,35,null]);
  const rows=prepareMoroccoPassengers();assert.equal(rows.length,13);
  assert.ok(rows.every(r=>r.weightKg===null&&r.sex===''&&r.firstName===''));
});
test('free names/nationalities are preserved; a computed weight field is not an explicit manual override',()=>{
  const rows=emptyMoroccoPassengers();rows[0]={lastName:'D’Artagnan',firstName:'Éléonore',nationality:'Française / Royaume-Uni',sex:'F',weightKg:999};
  const before=JSON.stringify(rows);const result=prepareMoroccoPassengers(rows);
  assert.equal(result[0].weightKg,74);assert.equal(result[0].lastName,'D’Artagnan');assert.equal(result[0].nationality,'Française / Royaume-Uni');assert.equal(JSON.stringify(rows),before);
  rows[0]={...rows[0],sex:'E'};assert.equal(prepareMoroccoPassengers(rows)[0].weightKg,35);
});
test('missing category on an occupied row, invalid category or more than thirteen passengers are explicit',()=>{
  assert.throws(()=>prepareMoroccoPassengers([{...emptyMoroccoPassengers()[0],lastName:'Nom'}]),/Passager 1.*H, F ou E/);
  assert.throws(()=>prepareMoroccoPassengers([{...emptyMoroccoPassengers()[0],sex:'X'}]),/Passager 1.*invalides/);
  assert.throws(()=>prepareMoroccoPassengers(Array(14).fill(emptyMoroccoPassengers()[0])),/13 passagers/);
});

test('explicit personal weight overrides each category, survives repeated preparation and is never mutated',()=>{
  const row={lastName:'Nom',firstName:'Prénom',nationality:'Marocaine',sex:'H',customWeightKg:81.5};
  for(const sex of ['H','F','E']){
    const rows=[{...row,sex}];const before=JSON.stringify(rows);const result=prepareMoroccoPassengers(rows);
    assert.equal(result[0].weightKg,81.5);assert.equal(result[0].customWeightKg,81.5);assert.equal(prepareMoroccoPassengers(result)[0].weightKg,81.5);assert.equal(JSON.stringify(rows),before);
  }
  assert.equal(prepareMoroccoPassengers([{...row,sex:'F',customWeightKg:undefined}])[0].weightKg,74);
  assert.equal(prepareMoroccoPassengers([{...row,sex:'F',customWeightKg:92}])[0].weightKg,92); // A manual value equal to a previous default is still manual.
  assert.throws(()=>prepareMoroccoPassengers([{...row,sex:''}]),/choisissez H, F ou E/);
});
test('custom weights must be finite positive numbers, without silently falling back to the category',()=>{
  for(const customWeightKg of [0,-1,NaN,Infinity,null,'81'])assert.throws(()=>prepareMoroccoPassengers([{...emptyMoroccoPassengers()[0],sex:'H',customWeightKg}]),/poids personnalisé.*strictement positif/);
});
