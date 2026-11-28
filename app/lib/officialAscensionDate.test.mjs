import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAscensionDate, formatAscensionDate, openAscensionDatePicker } from './officialAscensionDate.ts';

test('date française : frappe progressive, invalides et années bissextiles', () => {
  const text = '28/11/2026';
  for (let i = 0; i < text.length; i++) assert.equal(parseAscensionDate(text.slice(0, i)), null);
  assert.equal(parseAscensionDate(text), '2026-11-28');
  for (const invalid of ['', '31/04/2026', '29/02/2026', '29/02/1900', '00/11/2026', '28/00/2026', '28/13/2026', '28/11/0000', '2026-11-28', '1/2/2026']) assert.equal(parseAscensionDate(invalid), null, invalid);
  assert.equal(parseAscensionDate('29/02/2000'), '2000-02-29');
  assert.equal(parseAscensionDate('29/02/2028'), '2028-02-29');
});

test('aucune conversion de fuseau lors des allers-retours français/ISO', () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ['Europe/Paris', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Africa/Casablanca']) {
      process.env.TZ = tz;
      for (const iso of ['2026-03-29', '2026-10-25', '2026-11-28', '2028-02-29']) assert.equal(parseAscensionDate(formatAscensionDate(iso)), iso);
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  assert.equal(formatAscensionDate(''), '');
});

test('ouverture explicite avec repli natif si showPicker manque ou est refusé', () => {
  let calls = 0, focused = 0;
  openAscensionDatePicker({ showPicker() { calls++; }, focus() { focused++; } });
  assert.equal(calls, 1); assert.equal(focused, 0);
  openAscensionDatePicker({ focus() { focused++; } });
  openAscensionDatePicker({ showPicker() { throw new Error('NotAllowedError'); }, focus() { focused++; } });
  openAscensionDatePicker(null);
  assert.equal(focused, 0);
});
