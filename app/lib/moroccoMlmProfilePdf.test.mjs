import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFCheckBox, PDFName, decodePDFRawStream } from 'pdf-lib';
import { createMoroccoFlightDossierPdf } from './moroccoFlightDossierPdf.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { mlmBalloon, withConfirmedMlm } from './balloonMinimumLandingMass.fixtures.mjs';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';
import { applyMoroccoDossierLoading, calculateMoroccoLandingMass } from './moroccoDossierLoading.ts';
const textStreams=pdf=>pdf.getPages().flatMap(p=>{const c=p.node.Contents();return Array.from({length:c.size()},(_,i)=>Buffer.from(decodePDFRawStream(c.lookup(i)).decode()).toString());}).join('\n');
const has=(pdf,text)=>textStreams(pdf).includes(Buffer.from(text,'latin1').toString('hex').toUpperCase());
async function fixture(confirmed=false,weight=326) {
  const input=await dossierPdfFixture();
  input.dossier.balloon=confirmed?withConfirmedMlm(mlmBalloon()):mlmBalloon();
  input.dossier.startedAt='2026-11-27T05:30:00Z';input.dossier.launchTimeZone='Africa/Casablanca';
  input.dossierReference={date:'2026-11-26',time:'08:30'};
  input.passengers=[{lastName:'Épreuve',firstName:'Pilote test',sex:'H',customWeightKg:weight,nationality:'Marocaine'}];
  input.loading={pilotKg:60,equipmentKg:5,passengerCount:1,expectedGasConsumptionKg:70};
  input.loadInput=buildLoadCalculationInput({balloon:input.dossier.balloon,occupantsWeightKg:0,launchElevationMslM:47,plannedMaximumAltitudeMslM:1000,groundTemperature:input.dossier.operations.load.temperature});
  return input;
}
test('CN-CBN regression 1041 − 70 = 971; documented 1247 and indicative −276 without confirming a limit',async()=>{
  const input=await fixture(),landing=calculateMoroccoLandingMass(applyMoroccoDossierLoading(input));
  assert.equal(landing.takeoffKg,1041);assert.equal(landing.landingKg,971);assert.equal(landing.minimum.kg,null);assert.equal(landing.minimum.displayKg,1247);assert.equal(landing.marginKg,-276);
  const pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,{error:'offline'})),form=pdf.getForm();
  for(const [name,value] of Object.entries({'charge-masse-prevue':'1 041','charge-gaz-consomme-prevu':'70','charge-masse-atterrissage-estimee':'971','charge-masse-minimale-atterrissage':'1 247','charge-marge-mlm':'-276'}))assert.equal(form.getTextField(name).getText(),value,name);
  assert.ok(has(pdf,'Valeur constructeur à confirmer'));assert.ok(has(pdf,'Comparaison indicative'));assert.ok(has(pdf,'Autonomie carburant non vérifiée'));
  assert.equal(has(pdf,"Masse minimale à l'atterrissage non respectée"),false);
  assert.equal(form.getTextField('fpl-maroc-13t').getText(),'0530');assert.match(form.getTextField('fpl-maroc-18').getText(),/DOF\/261127/);
  assert.equal(form.getTextField('pax-date').getText(),'26/11/2026');assert.equal(form.getTextField('pax-heure').getText(),'08:30');
});
test('confirmed profile reused without export confirmation; negative red and nonnegative green; independent fields survive save/reopen',async()=>{
  for(const [weight,expected] of [[326,-276],[602,0],[700,98]]) {
    const input=await fixture(true,weight),pdf=await PDFDocument.load(await createMoroccoFlightDossierPdf(input,{error:'offline'})),form=pdf.getForm();
    assert.equal(form.getTextField('charge-marge-mlm').getText(),String(expected));
    const da=form.getTextField('charge-marge-mlm').acroField.getDefaultAppearance();
    assert.match(da,expected<0?/0\.75 0\.08 0\.08 rg/:/0\.05 0\.45 0\.18 rg/);
    assert.equal(has(pdf,"Masse minimale à l'atterrissage non respectée"),expected<0);
    assert.ok(has(pdf,'ne valide ni'));assert.ok(has(pdf,'Autonomie carburant non vérifiée'));
    form.getTextField('charge-masse-minimale-atterrissage').setText('1250');
    const reopened=await PDFDocument.load(await pdf.save());
    assert.equal(reopened.getForm().getTextField('charge-masse-minimale-atterrissage').getText(),'1250');
    assert.equal(reopened.getForm().getTextField('charge-masse-minimale-atterrissage').isReadOnly(),false);
    assert.equal(reopened.getForm().getTextField('charge-marge-mlm').getText(),String(expected));
    assert.equal(reopened.getForm().getFields().filter(f=>f instanceof PDFCheckBox).length,39);
    assert.equal(reopened.getForm().getFields().filter(f=>f.getName().startsWith('fpl-maroc-')).length,29);
    assert.equal(reopened.catalog.has(PDFName.of('JavaScript')),false);
  }
});
