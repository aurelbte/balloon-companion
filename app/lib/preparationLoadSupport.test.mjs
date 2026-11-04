import test from 'node:test';
import assert from 'node:assert/strict';
import { describePreparationLoad } from './preparationLoadSupport.ts';
import { calculateOfficialLoad } from './loadPerformance/engine.ts';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';
import { resolveLoadGroundTemperature } from './loadGroundTemperatureSelection.ts';
import { selectFlightDossierTrace } from './flightDossierEntry.ts';

const balloon = { id: 'actual-selected-id', manufacturer: 'Kubíček', model: 'BB26', volumeM3: 2600, configurationLimitsConfirmed: true, applicableMtowKg: 840, weights: { envelopeKg: 100, basketKg: 100, burnerKg: 100, fullCylinders: [] } };
const inputFor = selected => buildLoadCalculationInput({ balloon: selected, occupantsWeightKg: 150, launchElevationMslM: 50, plannedMaximumAltitudeMslM: 1000, groundTemperature: resolveLoadGroundTemperature('manual', '15', null) });
test('15 C manual does not activate documentary Kubicek data; diagnosis preserves actual selected mapping and status', () => {
  const input = inputFor(balloon), result = calculateOfficialLoad(input);
  assert.equal(input.balloonId, balloon.id);
  assert.equal(input.manufacturer, 'Kubíček');
  assert.equal(input.model, 'BB26');
  assert.equal(input.groundTemperature.temperatureC, 15);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reasonCode, 'UNSUPPORTED_MODEL');
  const diagnosis = describePreparationLoad(input, result);
  assert.match(diagnosis.parameterId, /KUBICEK/);
  assert.match(diagnosis.manualRevision, /Revision 19/);
  assert.equal(diagnosis.candidateEnabled, false);
  assert.match(diagnosis.message, /données constructeur présentes/);
  assert.match(diagnosis.message, /calcul non activé dans Prépa/);
});
test('Cameron alias mapping remains enabled while unknown models remain unavailable with an explicit reason', () => {
  const input = inputFor({ ...balloon, manufacturer: 'Cameron', model: 'Z105', volumeM3: 2974, applicableMtowKg: 952 });
  const result = calculateOfficialLoad(input);
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(describePreparationLoad(input, result).candidateEnabled, true);
  const unknown = { ...input, model: 'UNKNOWN' };
  const diagnosis = describePreparationLoad(unknown, calculateOfficialLoad(unknown));
  assert.equal(diagnosis.parameterId, null);
  assert.match(diagnosis.message, /UNKNOWN.*aucun calcul pris en charge/);
});
const trace = { traceId: 'one', model: { label: 'AROME', providerModelId: 'arome_seamless' }, projection: { startedAt: '2026-11-05T10:00:00Z', durationSeconds: 60, points: [{ latitude: 50, longitude: 3, altitudeAmslM: 100, timestamp: '2026-11-05T10:00:00Z' }, { latitude: 50.01, longitude: 3.01, altitudeAmslM: 200, timestamp: '2026-11-05T10:01:00Z' }] } };
test('single valid strategy exposes PDF without a hard-to-hit arrival tap; multiple strategies require an explicit choice', () => {
  const second = { ...trace, traceId: 'two' };
  assert.equal(selectFlightDossierTrace([trace], null, []), trace);
  assert.equal(selectFlightDossierTrace([trace, second], null, []), undefined);
  assert.equal(selectFlightDossierTrace([trace, second], 'two', []), second);
  assert.equal(selectFlightDossierTrace([trace, second], null, ['two']), second);
  assert.equal(selectFlightDossierTrace([trace, second], null, ['one','two']), undefined);
  assert.equal(selectFlightDossierTrace([{ ...trace, projection: { ...trace.projection, points: [] } }], null, []), undefined);
  assert.equal(selectFlightDossierTrace([trace, trace], 'one', []), undefined);
});

test('CN-CHA / Ultramagic T150 at manual 15 C maps to FM04 Rev30 but remains unactivated in the production engine', () => {
  const selected = { ...balloon, id: 'cn-cha-selected-fixture', registration: 'CN-CHA', manufacturer: 'ultramagic', model: 'T150', volumeM3: 4245 };
  const input = inputFor(selected);
  const result = calculateOfficialLoad(input);
  assert.equal(input.model, 'T150');
  assert.equal(input.volumeM3, 4245);
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.reasonCode, 'UNSUPPORTED_MODEL');
  const diagnosis = describePreparationLoad(input, result);
  assert.equal(diagnosis.parameterId, 'ULTRAMAGIC_T150');
  assert.equal(diagnosis.manualRevision, 'FM04_REVISION_30');
  assert.equal(diagnosis.parameterStatus, 'CANDIDATE_PILOT_VALIDATION');
  assert.equal(diagnosis.candidateEnabled, false);
  assert.match(diagnosis.message, /T150.*calcul non activé dans Prépa/);
});
