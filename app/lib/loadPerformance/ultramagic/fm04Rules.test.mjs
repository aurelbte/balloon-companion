import test from 'node:test';
import assert from 'node:assert/strict';
import { ultramagicModelParameters } from '../modelParameters/ultramagicModels.ts';
import { fm04MinimumTom, fm04BasketDefault, fm04Compatibility } from './fm04Rules.ts';

test('all 50 exact models have a sourced minimum state, never an invented zero', () => {
  for (const {model} of ultramagicModelParameters) {
    const rule = fm04MinimumTom(model);
    assert.ok(rule, model);
    assert.equal(rule.source.manualRevision, 'FM04_REVISION_30');
    assert.ok(['5.7','5.8'].includes(rule.source.page));
    assert.equal(rule.source.pageRevision, rule.source.page === '5.7' ? 30 : 29);
    if (rule.state === 'NUMERIC') assert.ok(rule.kg > 0);
    else assert.equal('kg' in rule, false);
  }
  assert.equal(fm04MinimumTom('UNKNOWN'), undefined);
});

const minima = {
  M56Z:297, M60Z:299, M65Z:303, M70Z:306, M74Z:312,
  S105:480, V105:480, M105:480, M120:544, S130:588, M130:588, M145:656,
  T150:679, S160:728, M160:728, T180:816, N180:816, T210:960, N210:960,
  N250:1120, N300:1360, N355:1600, N370:1600, N390:1760, N415:1805,
  N425:1920, N450:1920, N500:2300, N550:2500,
};
test('numeric minima follow FM04 rows, with no extension of the landing rule to MZ', () => {
  for (const [model, kg] of Object.entries(minima)) {
    const rule = fm04MinimumTom(model);
    assert.equal(rule.state, 'NUMERIC'); assert.equal(rule.kg, kg, model);
    if (model.endsWith('Z')) assert.equal(rule.landingSource, undefined);
    else assert.deepEqual(rule.landingSource, { manualRevision:'FM04_REVISION_30', page:'2.3', pageRevision:27 });
  }
});

test('n/a differs from no minimum indicated, including the non-Z variants', () => {
  for (const model of ['V25','H31','H42','M42','H77','V77','M77','M77C','S90','V90','M90','Z90','G90']) assert.equal(fm04MinimumTom(model).state, 'NOT_APPLICABLE', model);
  for (const model of ['H56','V56','M56','M56C','H65','V65','M65','M65C']) assert.equal(fm04MinimumTom(model).state, 'NOT_INDICATED', model);
});

test('basket defaults are exact p5.9 Rev27 values; C13 has no invented value', () => {
  const expected = {C0:258,C1:1032,C2:756,C3:1365,C4:1569,C5:1569,C6:1076,C7:1288,C8:1794,C9:2208,C10:1000,C11:2680,C12:3000,C14:5000,C15:5000};
  for (const [basket, kg] of Object.entries(expected)) assert.deepEqual(fm04BasketDefault(basket), {state:'NUMERIC',kg,source:{manualRevision:'FM04_REVISION_30',page:'5.9',pageRevision:27}});
  assert.equal(fm04BasketDefault('C13').state, 'NOT_DOCUMENTED');
  assert.equal(fm04BasketDefault('unknown').state, 'NOT_DOCUMENTED');
});

test('44 explicit compatibility rows; G90 and MZ never inherit another row', () => {
  const missing = ['G90','M56Z','M60Z','M65Z','M70Z','M74Z'];
  let count=0;
  for (const {model} of ultramagicModelParameters) {
    const row=fm04Compatibility(model);
    if (missing.includes(model)) assert.equal(row,undefined,model);
    else { assert.ok(row,model); count++; assert.equal(row.source.pageRevision,row.source.page==='5.6'?27:30); }
  }
  assert.equal(count,44);
  assert.deepEqual(fm04Compatibility('V25').baskets,[]); // SOLO is not a C-basket cell.
});

test('shading exceptions remain on the exact envelope row, including burner arrays', () => {
  assert.ok(fm04Compatibility('H42').burners.includes('MK2SINGLE'));
  assert.ok(!fm04Compatibility('M42').burners.includes('MK2SINGLE'));
  assert.ok(fm04Compatibility('S90').burners.includes('MK21SINGLE'));
  assert.ok(!fm04Compatibility('V90').burners.includes('MK21SINGLE'));
  assert.ok(fm04Compatibility('M145').burners.includes('MK2TRIPLE'));
  assert.ok(!fm04Compatibility('T150').burners.includes('MK2TRIPLE'));
  assert.ok(fm04Compatibility('N425').burners.includes('MK2QUAD'));
  assert.ok(!fm04Compatibility('N415').burners.includes('MK2QUAD'));
  assert.ok(fm04Compatibility('N500').baskets.includes('C11'));
  assert.ok(!fm04Compatibility('N500').burners.includes('BMK050TRIPLE'));
  assert.ok(!fm04Compatibility('T150').burners.includes('MK21')); // Array is required.
});
