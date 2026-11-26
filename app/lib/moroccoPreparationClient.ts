import type { FlightDossierData } from "./flightDossierPdf.ts";
import { prepareFlightDossierWeather } from "./flightDossierWeather.ts";
import { archiveSourceTimes, currentMoroccoWeatherArchiveStore, inspectMoroccoWeatherArchives, moroccoWeatherMatchKey, type MoroccoWeatherArchiveStore, type SavedMoroccoWeatherArchive } from "./moroccoWeatherArchive.ts";
import { currentCalculationArchive, waitForMoroccoCalculationArchive } from "./moroccoCalculationArchive.ts";

/** Reuse calculation evidence only. No writing-date cutoff and no weather fetch at export. */
export async function loadMoroccoDossierPreparation(dossier: FlightDossierData, signal?: AbortSignal, options: { store?: MoroccoWeatherArchiveStore; memoryArchive?: SavedMoroccoWeatherArchive | null } = {}) {
  const notices: string[] = [];
  try { await waitForMoroccoCalculationArchive(dossier.moroccoPreparationIdentity); }
  catch { notices.push("Sauvegarde locale échouée : les données encore en mémoire peuvent être utilisées, sans garantie de conservation après fermeture."); }
  signal?.throwIfAborted();
  const memory = options.memoryArchive === undefined ? currentCalculationArchive(dossier.moroccoPreparationIdentity) : options.memoryArchive;
  let values: SavedMoroccoWeatherArchive[] = [];
  try { values = await (options.store ?? currentMoroccoWeatherArchiveStore()).matching(moroccoWeatherMatchKey(dossier)); }
  catch { notices.push("Archive locale inaccessible ou identité complète absente : aucune autre préparation ne sera substituée."); }
  signal?.throwIfAborted();
  try {
    const inspected = inspectMoroccoWeatherArchives([...values, ...(memory && !values.some(value => value.id === memory.id) ? [memory] : [])], dossier);
    if (inspected.archive) {
      const saved = inspected.archive, persisted = values.some(value => value.id === saved.id);
      return { dossier, weather: { ...saved.weather, notices: [
        ...notices,
        `Données ${persisted ? "archivées localement" : "en mémoire uniquement, non garanties après fermeture"} de cette trajectoire : réception ${saved.receivedAt}, calcul ${saved.trajectory.calculatedAtIso}.`,
        "Échéances et acquisitions originales conservées. La date de rédaction ne détermine pas la météo ; ces données ne constituent pas un historique disponible à une date antidatée.",
        "Indicateurs de fraîcheur des bulletins évalués lors de leur acquisition, pas à la rédaction ni à l’export différé.",
        ...([...saved.rawForecasts.map(raw => raw.receivedAt), ...["departure", "landing"].flatMap(location => Object.values(saved.weather.aviation[location as "departure" | "landing"]).flatMap(product => product.result.data?.sourceUpdatedAt ? [product.result.data.sourceUpdatedAt] : []))].some(stamp => Date.parse(stamp) > Date.parse(dossier.startedAt)) ? ["Attention : acquisition météo postérieure au décollage prévu. Elle ne prouve pas les prévisions disponibles avant le vol."] : []),
        ...(archiveSourceTimes(saved).some(stamp => Date.parse(stamp) > Date.now()) || Date.parse(saved.storedAt) > Date.now() ? ["Horodatages postérieurs à l’horloge actuelle de l’appareil : vérifier la cohérence des horloges. Les dates sources restent inchangées."] : []),
        ...saved.weather.notices,
      ] } };
    }
    notices.push(inspected.notice);
  } catch { notices.push("Identité ou provenance de la préparation non vérifiable."); }
  const unavailable = "Non disponible : données météo du calcul non conservées pour cette trajectoire. Aucun rechargement ni substitution à l’export.";
  const weather = await prepareFlightDossierWeather({ traceId: dossier.traceId, weatherModel: dossier.model.providerModelId, departure: dossier.points[0], landing: dossier.points.at(-1)! }, {
    stations: async () => [],
    aviation: async () => ({ data: null, error: { code: "NO_DATA", message: unavailable } }),
    altitude: async () => { throw new Error(unavailable); }, ground: async () => { throw new Error(unavailable); },
  });
  weather.notices = [...notices, unavailable];
  return { dossier, weather };
}
