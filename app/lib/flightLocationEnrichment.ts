import type { RecordedFlight } from "./recordedFlight.ts";
import { IndexedDbRecordedFlightStorage, type RecordedFlightStorage } from "./recordedFlightStorage.ts";
import { getRuntimeDataScope } from "./auth/dataScopeRuntime.ts";
import { enrichJournalFlightLocations, loadFlightCompletionState } from "./flightCompletionStorage.ts";
import { isUnknownFlightLocation, resolveRecordedFlightLocations } from "./flightLocationResolver.ts";
import { REVERSE_GEOCODING_GAP_MS } from "./reverseGeocoding.ts";

const inProgress = new Map<string, Promise<RecordedFlight | null>>();

/** Shared by the detached finalization enrichment and later location-only retries. */
export function enrichRecordedFlightLocations(
  flight: RecordedFlight,
  storage: RecordedFlightStorage,
  preparedStartName?: string,
  resolveLocations = resolveRecordedFlightLocations,
): Promise<RecordedFlight | null> {
  const scope = getRuntimeDataScope();
  if (!scope) return Promise.resolve(null);
  const key = `${scope}:${flight.id}`;
  const pending = inProgress.get(key);
  if (pending) return pending;
  const job = (async () => {
    const current = await storage.getFlight(flight.id);
    if (!current || current.status !== "COMPLETED" || getRuntimeDataScope() !== scope) return null;
    const enriched = await resolveLocations(current, preparedStartName);
    if (getRuntimeDataScope() !== scope) return null;
    const latest = await storage.getFlight(flight.id);
    if (!latest || getRuntimeDataScope() !== scope) return null;
    // Preserve names obtained/edited while the network request was pending.
    const startLocationLabel = isUnknownFlightLocation(latest.startLocationLabel) ? enriched.startLocationLabel : latest.startLocationLabel;
    const endLocationLabel = isUnknownFlightLocation(latest.endLocationLabel) ? enriched.endLocationLabel : latest.endLocationLabel;
    const generatedTitle = `${startLocationLabel} → ${endLocationLabel}`;
    const updated = startLocationLabel === latest.startLocationLabel && endLocationLabel === latest.endLocationLabel && generatedTitle === latest.generatedTitle
      ? latest : await storage.updateFlightLocations(flight.id, {
        startLocationLabel, endLocationLabel, generatedTitle,
      });
    if (!updated || getRuntimeDataScope() !== scope) return null;
    const journal = loadFlightCompletionState().journalFlights.find(item => (item.sourceFlightId ?? item.id) === updated.id);
    if (!journal || journal.departure !== updated.startLocationLabel || journal.arrival !== updated.endLocationLabel ||
      journal.startLocationLabel !== updated.startLocationLabel || journal.endLocationLabel !== updated.endLocationLabel ||
      journal.generatedTitle !== updated.generatedTitle) {
      if (!enrichJournalFlightLocations(updated)) throw new Error("Les lieux du vol sont conservés, mais leur sauvegarde dans le Journal a échoué. Une prochaine reprise réessaiera.");
    }
    return updated;
  })();
  inProgress.set(key, job);
  void job.finally(() => { if (inProgress.get(key) === job) inProgress.delete(key); }).catch(() => undefined);
  return job;
}

const retryRuns = new Map<string, Promise<void>>();

export function retryIncompleteFlightLocations(): Promise<void> {
  const scope = getRuntimeDataScope();
  if (!scope || (typeof navigator !== "undefined" && !navigator.onLine)) return Promise.resolve();
  const existing = retryRuns.get(scope);
  if (existing) return existing;
  const job = (async () => {
    const storage = new IndexedDbRecordedFlightStorage();
    const flights = await storage.listFlights();
    for (const flight of flights) {
      if (getRuntimeDataScope() !== scope || !navigator.onLine) break;
      if (flight.status !== "COMPLETED") continue;
      try { await enrichRecordedFlightLocations(flight, storage); }
      catch (error) { console.warn("[Flight locations] Reprise différée", error); }
      if (isUnknownFlightLocation(flight.startLocationLabel) || isUnknownFlightLocation(flight.endLocationLabel)) {
        await new Promise(resolve => setTimeout(resolve, REVERSE_GEOCODING_GAP_MS));
      }
    }
  })();
  retryRuns.set(scope, job);
  void job.finally(() => { if (retryRuns.get(scope) === job) retryRuns.delete(scope); }).catch(() => undefined);
  return job;
}
