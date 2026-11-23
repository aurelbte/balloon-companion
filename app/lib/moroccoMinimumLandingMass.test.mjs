import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFCheckBox, PDFName } from 'pdf-lib';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { moroccoMinimumLandingMass, moroccoLandingMassConfigurationKey, moroccoLandingMassRuleKey } from './moroccoMinimumLandingMass.ts';
import { MOROCCO_LANDING_MASS_RULES } from './moroccoMinimumLandingMassData.ts';
import { createMoroccoFlightDossierPdf } from './moroccoFlightDossierPdf.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';

function evidence(balloon, rule) {
  return { manualSha256: rule.source.sha256, variant: rule.variant, documentaryRuleKey: moroccoLandingMassRuleKey(rule), balloonConfigurationKey: moroccoLandingMassConfigurationKey(balloon),
    configurationReference: 'Manual applicability / signed build standard reviewed for test aircraft', manualApplicabilityConfirmed: true,
    normalOperation: true, supplementsReview: 'NO_MLM_OVERRIDE' };
}

test('documentary Z275 MLM is not promoted to a validated aircraft limit or derived from MTOM', async () => {
  const { dossier } = await dossierPdfFixture();
  const balloon = { ...dossier.balloon, model: 'Z275', volumeM3: 7787 };
  const value = moroccoMinimumLandingMass(balloon);
  assert.equal(value.kg, null);
  assert.match(value.notice, /À vérifier dans le manuel de vol/);
  assert.match(value.notice, /MLM documentaire/);
  assert.match(value.source, /2-7/);
  assert.equal(moroccoMinimumLandingMass({ ...balloon, model: 'UNKNOWN', applicableMtowKg: 9999 }).kg, null);
});

test('every documented rule prefills only its exact reviewed edition/type/variant/volume, independent of lift method validation', async () => {
  const { dossier } = await dossierPdfFixture();
  for (const p of MOROCCO_LANDING_MASS_RULES) {
    const balloon = { ...dossier.balloon, manufacturer: p.manufacturer, model: p.model, volumeM3: p.volumeM3, configurationLimitsConfirmed: false };
    const proof = evidence(balloon, p);
    assert.equal(moroccoMinimumLandingMass(balloon).kg, null);
    assert.equal(moroccoMinimumLandingMass(balloon, proof).kg, p.value, `${p.model} ${p.source.edition}`);
    assert.match(moroccoMinimumLandingMass(balloon, proof).source, /2\.9|2\.6/);
    assert.equal(p.unit, 'kg'); assert.ok(p.conditions.length); assert.ok(p.source.sha256.length === 64);
  }
});

test('Z275 is explicitly 1247 kg in both local editions, never universally inferred from 2494/1999 MTOM', async () => {
  const { dossier } = await dossierPdfFixture();
  const rules = MOROCCO_LANDING_MASS_RULES.filter(p => p.manufacturer === 'Cameron' && p.model === 'Z275');
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map(p => p.value), [1247, 1247]);
  assert.ok(rules.find(p => p.source.file === 'Manuel-de-Vol-Actuel-FR.pdf').source.pages.includes('2-6 (A12)'));
  for (const rule of rules) {
    const balloon = { ...dossier.balloon, model: 'Z-275', volumeM3: 7788, applicableMtowKg: 1999 };
    const proof = evidence(balloon, rule);
    assert.equal(moroccoMinimumLandingMass(balloon, proof).kg, 1247);
    for (const patch of [{ documentaryRuleKey: undefined }, { documentaryRuleKey: 'changed-reference' }, { manualSha256: 'old-unverified-edition' }, { variant: '275LW' }, { supplementsReview: 'UNREVIEWED' }, { supplementsReview: 'MLM_OVERRIDE' }, { configurationReference: '' }, { manualApplicabilityConfirmed: false }, { normalOperation: false }, { balloonConfigurationKey: 'other-aircraft' }]) {
      assert.equal(moroccoMinimumLandingMass(balloon, { ...proof, ...patch }).kg, null);
    }
    assert.equal(moroccoMinimumLandingMass({ ...balloon, weights: { ...balloon.weights, basketKg: 151 } }, proof).kg, null);
    const wrongVolume = { ...balloon, volumeM3: 7787 };
    assert.equal(moroccoMinimumLandingMass(wrongVolume, evidence(wrongVolume, rule)).kg, null);
  }
});

test('variants and manufacturer identities stay exact; numeric small-MZ takeoff minima are not landing minima', async () => {
  const { dossier } = await dossierPdfFixture();
  for (const model of ['275', 'Z275LW', 'Z300', 'Z425', 'A340/340HL', 'UNKNOWN']) {
    assert.equal(moroccoMinimumLandingMass({ ...dossier.balloon, model }).kg, null);
    assert.ok(!MOROCCO_LANDING_MASS_RULES.some(p => p.manufacturer === 'Cameron' && p.model === model));
  }
  for (const model of ['H65', 'M56Z', 'M60Z', 'M65Z', 'M70Z', 'M74Z', 'S90']) {
    assert.ok(!MOROCCO_LANDING_MASS_RULES.some(p => p.manufacturer === 'Ultramagic' && p.model === model));
  }
  assert.equal(MOROCCO_LANDING_MASS_RULES.find(p => p.manufacturer === 'Ultramagic' && p.model === 'T150').value, 679);
  assert.equal(MOROCCO_LANDING_MASS_RULES.find(p => p.manufacturer === 'Ultramagic' && p.model === 'N550').value, 2500);
  assert.equal(MOROCCO_LANDING_MASS_RULES.find(p => p.model === 'A340').value, 1429);
  assert.equal(MOROCCO_LANDING_MASS_RULES.find(p => p.model === 'A340HL').value, 1542);
});

test('available local manuals retain their audited byte fingerprints', () => {
  for (const source of new Map(MOROCCO_LANDING_MASS_RULES.map(p => [p.source.file, p.source])).values()) {
    // Manuals are user-owned, outside tracked application assets; CI need not distribute them.
    if (existsSync(source.file)) assert.equal(createHash('sha256').update(readFileSync(source.file)).digest('hex'), source.sha256, source.file);
  }
});

test('blank minimum landing mass is editable and survives save/reopen without changing other masses or checklist', async () => {
  const input = await dossierPdfFixture(), before = JSON.stringify(input);
  const pdf = await PDFDocument.load(await createMoroccoFlightDossierPdf(input, { error: 'Carte hors ligne' }));
  const form = pdf.getForm(), field = form.getTextField('charge-masse-minimale-atterrissage');
  assert.equal(field.getText() ?? '', ''); assert.equal(field.isReadOnly(), false);
  assert.ok(field.acroField.getWidgets()[0].getAppearances().normal);
  const mtom = form.getTextField('charge-mtom').getText();
  field.setText('1 247');
  const reopened = await PDFDocument.load(await pdf.save());
  assert.equal(reopened.getForm().getTextField(field.getName()).getText(), '1 247');
  assert.equal(reopened.getForm().getTextField('charge-mtom').getText(), mtom);
  assert.equal(reopened.getForm().getFields().filter(f => f instanceof PDFCheckBox).length, 39);
  assert.equal(JSON.stringify(input), before);
});

test('existing PDF widget is prefilled from reviewed Z275 or T150 data and remains independently editable across saves', async () => {
  for (const model of ['Z275', 'T150']) {
    const input = await dossierPdfFixture();
    const rule = MOROCCO_LANDING_MASS_RULES.find(p => p.model === model);
    Object.assign(input.dossier.balloon, { manufacturer: rule.manufacturer, model, volumeM3: rule.volumeM3 });
    input.minimumLandingMassApplicability = evidence(input.dossier.balloon, rule);
    const before = JSON.stringify(input);
    const pdf = await PDFDocument.load(await createMoroccoFlightDossierPdf(input, { error: 'Carte hors ligne' }));
    const form = pdf.getForm(), name = 'charge-masse-minimale-atterrissage';
    assert.equal(form.getTextField(name).getText(), rule.value.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' '));
    assert.equal(form.getTextField(name).acroField.dict.get(PDFName.of('DV')).decodeText(), form.getTextField(name).getText());
    assert.equal(form.getTextField(name).isReadOnly(), false);
    assert.equal(form.getFields().filter(f => f.getName() === name).length, 1);
    const mtom = form.getTextField('charge-mtom').getText();
    form.getTextField(name).setText('Correction manuelle');
    const reopened = await PDFDocument.load(await pdf.save());
    assert.equal(reopened.getForm().getTextField(name).getText(), 'Correction manuelle');
    assert.equal(reopened.getForm().getTextField('charge-mtom').getText(), mtom);
    assert.equal(reopened.getForm().getFields().filter(f => f instanceof PDFCheckBox).length, 39);
    assert.equal(JSON.stringify(input), before);
  }
});
