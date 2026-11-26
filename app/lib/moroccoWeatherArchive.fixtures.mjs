import { dossierPdfFixture } from './flightDossierPdf.fixtures.mjs';
import { moroccoCalculationIdentity, archiveMoroccoCalculation } from './moroccoCalculationArchive.ts';
export const receivedAt = '2026-11-05T08:01:00.000Z', storedAt = '2026-11-05T08:01:01.000Z';
export const memory = () => { const rows = new Map(); return { rows, async saveOnce(value) { if (!rows.has(value.id)) rows.set(value.id, structuredClone({ ...value, storedAt })); }, async matching(key) { return structuredClone([...rows.values()].filter(row => row.matchKey === key)); } }; };
export async function fixture() {
  const { dossier } = await dossierPdfFixture();
  const first = dossier.points[0];
  const request = { version: 2, launchSite: { name: dossier.launchSiteName, latitude: first.latitude, longitude: first.longitude }, launchTimeZone: dossier.launchTimeZone,
    launchDateTimeIso: dossier.startedAt, durationSeconds: dossier.durationSeconds, weatherModel: dossier.model.providerModelId, altitudesAmslM: [600], primaryAltitudeAmslM: 600, climbRateMps: 2, descentRateMps: 2 };
  const trajectory = { traceId: dossier.traceId, label: dossier.strategyLabel, altitudeKey: '600', altitudeAmslM: 600, model: dossier.model,
    weatherFetchedAt: '2026-11-05T08:00:00Z', calculatedAtIso: '2026-11-05T07:59:30Z', modelRunAt: null,
    projection: { points: dossier.points, startedAt: dossier.startedAt, durationSeconds: dossier.durationSeconds } };
  const raw = { source: 'Open-Meteo', endpoint: 'https://api.open-meteo.com/v1/forecast', kind: 'calculation', model: request.weatherModel, query: { latitude: first.latitude, longitude: first.longitude, validAt: request.launchDateTimeIso, weatherModel: request.weatherModel }, receivedAt: trajectory.weatherFetchedAt,
    payload: { latitude: first.latitude, longitude: first.longitude, elevation: 47, generationtime_ms: 12, hourly_units: { wind_speed_80m: 'm/s', wind_direction_80m: '°' }, hourly: { time: ['2026-11-05T09:00','2026-11-05T10:00','2026-11-05T11:00','2026-11-05T12:00'], wind_speed_80m: [4,5,6,7], wind_direction_80m: [240,250,260,270] } } };
  const payload = { ok: true, terrainAltitudeAmslM: 47, moroccoCalculation: { request, rawForecasts: [raw] } };
  trajectory.moroccoPreparationIdentity = moroccoCalculationIdentity(request, trajectory, 47);
  dossier.moroccoPreparationIdentity = trajectory.moroccoPreparationIdentity;
  const store = memory(); await archiveMoroccoCalculation(payload, trajectory, receivedAt, store);
  const record = [...store.rows.values()][0];
  return { dossier, trajectory, request, payload, store, record };
}

