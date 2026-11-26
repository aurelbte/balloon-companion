import { fixture, memory, receivedAt } from './moroccoWeatherArchive.fixtures.mjs';
import { archiveMoroccoCalculation } from './moroccoCalculationArchive.ts';
import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { mlmBalloon, withConfirmedMlm } from './balloonMinimumLandingMass.fixtures.mjs';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';
/** Synthetic, deterministic end-to-end fixture; never operational weather. */
export async function moroccoWorkflowFixture() {
 const {dossier,trajectory,payload}=await fixture(),store=memory();
 const first=dossier.points[0],last=dossier.points.at(-1);
 const original=(await dossierPdfFixture()).weather;
 payload.moroccoCalculation.aviation=[{departure:first,landing:last,data:original.aviation}];
 payload.moroccoCalculation.rawForecasts.push({source:'Open-Meteo',endpoint:'https://api.open-meteo.com/v1/forecast',kind:'ground',model:dossier.model.providerModelId,
  receivedAt:'2026-11-05T08:00:30Z',query:{latitude:last.latitude,longitude:last.longitude,landingAt:last.timestamp},
  payload:{latitude:last.latitude,longitude:last.longitude,utc_offset_seconds:0,hourly_units:{wind_speed_10m:'km/h',wind_direction_10m:'°',wind_gusts_10m:'km/h'},
   hourly:{time:['2026-11-05T11:00'],wind_speed_10m:[12],wind_direction_10m:[270],wind_gusts_10m:[18]}}});
 await archiveMoroccoCalculation(payload,trajectory,receivedAt,store);
 dossier.balloon=withConfirmedMlm(mlmBalloon());
 const loadInput=buildLoadCalculationInput({balloon:dossier.balloon,occupantsWeightKg:0,launchElevationMslM:47,plannedMaximumAltitudeMslM:1000,groundTemperature:dossier.operations.load.temperature});
 return {dossier,trajectory,payload,store,loadInput,passengers:[{lastName:'Épreuve',firstName:'Test',nationality:'Marocaine',sex:'H',customWeightKg:326}],loading:{pilotKg:60,equipmentKg:5,passengerCount:1,expectedGasConsumptionKg:70}};
}
