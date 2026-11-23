import type { FlightDossierData } from "./flightDossierPdf.ts";
import { resolveMoroccoDossierReference, type MoroccoDossierReference } from "./moroccoDossierReference.ts";
import { loadMoroccoFlightDossierWeather } from "./flightDossierWeatherClient.ts";
import { currentMoroccoWeatherArchiveStore, inspectMoroccoWeatherArchives, moroccoWeatherMatchKey, type MoroccoWeatherArchiveStore } from "./moroccoWeatherArchive.ts";
import { waitForMoroccoCalculationArchive } from "./moroccoCalculationArchive.ts";

/** Read local evidence first; the only network fallback is the bounded historical acquisition. */
export async function loadMoroccoDossierPreparation(dossier: FlightDossierData, reference?: MoroccoDossierReference, signal?: AbortSignal, options: { store?: MoroccoWeatherArchiveStore; fetchImpl?: typeof fetch } = {}) {
  const cutoff = resolveMoroccoDossierReference(dossier, reference).iso;
  let archiveNotice = "Aucune préparation locale correspondante enregistrée avant la référence. Historique fournisseur uniquement ; disponibilité des runs non attestée.";
  try {
    const store = options.store ?? currentMoroccoWeatherArchiveStore();
    let writeNotice = "";
    try { await waitForMoroccoCalculationArchive(dossier.moroccoPreparationIdentity); }
    catch (error) { writeNotice = `Sauvegarde de la préparation échouée : ${error instanceof Error ? error.message : "stockage indisponible"}. `; }
    signal?.throwIfAborted();
    const inspected = inspectMoroccoWeatherArchives(await store.matching(moroccoWeatherMatchKey(dossier)), dossier, cutoff);
    const saved = inspected.archive;
    archiveNotice = `${writeNotice}${inspected.notice} Historique fournisseur uniquement ; disponibilité des runs non attestée.`;
    signal?.throwIfAborted();
    if (saved) return { dossier: { ...dossier, ...saved.dossier }, weather: { ...saved.weather, notices: [
      ...(writeNotice ? [writeNotice.trim()] : []),
      `Préparation locale immuable : reçue ${saved.receivedAt}, enregistrée ${saved.storedAt} ; limite de disponibilité ${cutoff} (UTC).`,
      `Trajectoire conservée : calcul ${saved.trajectory.calculatedAtIso}, météo récupérée ${saved.trajectory.weatherFetchedAt}. Identité de run non attestée.`,
      ...saved.weather.notices,
    ] } };
  } catch (error) {
    signal?.throwIfAborted();
    archiveNotice = `Archive locale Maroc inaccessible : ${error instanceof Error ? error.message : "erreur de lecture"}. Historique fournisseur uniquement ; disponibilité des runs non attestée.`;
  }
  try {
    const weather = await loadMoroccoFlightDossierWeather(dossier, reference, signal, options.fetchImpl ?? fetch);
    return { dossier, weather: { ...weather, notices: [archiveNotice, ...weather.notices] } };
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(`${archiveNotice} ${error instanceof Error ? error.message : "Historique indisponible."}`);
  }
}
