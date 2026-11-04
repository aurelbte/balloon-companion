import { prepareFlightDossier } from './flightDossierEntry.ts';
import { prepareFlightDossierWeather } from './flightDossierWeather.ts';
import { prepareFlightDossierOperations } from './flightDossierOperations.ts';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';

export async function dossierPdfFixture({ kubicek = false, longRaw = false } = {}) {
  const balloon = { id: 'selected', registration: 'F-TEST', manufacturer: kubicek ? 'Kubíček' : 'Cameron', model: kubicek ? 'BB26' : 'Z105', volumeM3: kubicek ? 2600 : 2974, configurationLimitsConfirmed: true, applicableMtowKg: 952, weights: { envelopeKg: 100, basketKg: 150, burnerKg: 50, fullCylinders: [] }, documents: [] };
  const startedAt = '2026-11-05T10:00:00Z';
  const points = [0, 900, 1800, 2700, 3600].map((seconds, i) => ({ longitude: 3.05 + i * .02, latitude: 50.68 + i * .014, altitudeAmslM: [47,300,600,300,55][i], elapsedSeconds: seconds, timestamp: new Date(Date.parse(startedAt) + seconds * 1000).toISOString(), verticalPhase: 'level' }));
  const trace = { traceId: 'arome:strategie-selectionnee', label: 'Montée à 600 m - stratégie sélectionnée', model: { label: 'AROME', providerModelId: 'arome_seamless' }, projection: { points, startedAt, durationSeconds: 3600 } };
  const dossier = prepareFlightDossier(trace.traceId, [trace], balloon).data;
  dossier.launchSiteName = 'Bondues - Lille Marcq-en-Baroeul';
  dossier.launchTimeZone = 'Europe/Paris';
  const airspace = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[3.06,50.67],[3.14,50.67],[3.14,50.75],[3.06,50.75],[3.06,50.67]]] }, properties: { id: 'lille', airspaceId: 'lille', airspaceCompositeKey: 'lille', name: 'CTR LILLE - exemple de contrôle de mise en page', typeLabel: 'CTR', icaoClassLabel: 'D', lowerLimit: { value: 100, unit: 0, referenceDatum: 1 }, upperLimit: { value: 609.6, unit: 0, referenceDatum: 1 }, frequencies: [{ value: '118.550', name: 'LILLE TWR' }], sourceFrequencies: [{ value: '118.550', name: 'LILLE TWR' }], activity: null, onDemand: false, onRequest: false, byNotam: true, activeFrom: null, activeUntil: null } };
  dossier.operations = prepareFlightDossierOperations(dossier, buildLoadCalculationInput({ balloon, occupantsWeightKg: 200, launchElevationMslM: 47, plannedMaximumAltitudeMslM: 1000, groundTemperature: { temperatureC: 10, sourceModel: 'arome_seamless', forecastRun: '', validTime: startedAt } }), { type: 'FeatureCollection', features: [airspace] });
  const fetchedAt = '2026-11-05T08:00:00Z';
  const times = Array.from({ length: 6 }, (_, index) => new Date(Date.parse('2026-11-05T08:00:00Z') + index * 3600000).toISOString());
  const weather = await prepareFlightDossierWeather({ traceId: trace.traceId, weatherModel: trace.model.providerModelId, departure: points[0], landing: points.at(-1) }, {
    now: () => Date.parse(fetchedAt),
    stations: async () => [{ icao: 'LFQQ', name: 'Lille Lesquin', latitude: 50.57, longitude: 3.10, products: ['METAR','TAF'] }],
    aviation: async () => ({ data: { airport: 'LFQQ', metarRaw: 'LFQQ 050800Z 24006KT 9999 SCT030 11/08 Q1022', tafRaw: longRaw ? 'TAF LFQQ 050800Z 0509/0615 ' + 'LONGTOKEN'.repeat(400) + ' FIN-MESSAGE-INTEGRAL' : 'TAF LFQQ 050800Z 0509/0615 24008KT 9999 SCT030 TEMPO 0510/0514 4000 -RA BKN015', metarIssuedAt: fetchedAt, tafIssuedAt: fetchedAt, sourceUpdatedAt: fetchedAt, status: 'PARTIAL' }, error: null }),
    altitude: async () => ({ fetchedAt, column: { sourceModel: trace.model.providerModelId, sourceLatitude: 50.68, sourceLongitude: 3.05, slices: times.filter((_, i) => i !== 2).map((validAt) => ({ validAt, levels: [80,120,180,300,600,1000].map((height, i) => ({ sourceType: 'near-surface', sourceLevel: `${height} m AGL`, geopotentialHeightAmslM: 47 + height, windSpeedMps: 2.5 + i, windDirectionFromDeg: 235 + i * 4 })), rejectedLevels: [{ sourceLevel: '850 hPa', reason: 'Hauteur géopotentielle absente' }] })) } }),
    ground: async () => ({ model: trace.model.providerModelId, latitude: 50.74, longitude: 3.13, sourceUpdatedAt: fetchedAt, points: times.filter((_, i) => i !== 1).map((timestamp, i) => ({ timestamp, model: trace.model.providerModelId, windDirectionDeg: 240 + i, windSpeedKmh: 11 + i, ...(i === 2 ? {} : { windGustKmh: 17 + i }) })) }),
  });
  return { dossier, weather, generatedAt: fetchedAt };
}
