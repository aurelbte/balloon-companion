"use client";

import { useCallback, useEffect, useState } from "react";
import { calculateRecordedFlightSummary, finalizeRecordedFlight, type RecordedFlight } from "../../lib/recordedFlight";
import { IndexedDbRecordedFlightStorage } from "../../lib/recordedFlightStorage";
import { loadFlightCompletionState, persistRecordedFlightInJournal } from "../../lib/flightCompletionStorage";
import { loadFlightSession } from "../../lib/flightSessionStorage";
import { legacyFlightSessionToRecordedFlight } from "../../lib/realFlightJournal";
import styles from "./page.module.css";

type RecoveryCandidate = { flight: RecordedFlight; location: string; journalPresent: boolean };
type StorageSummary = { area: "localStorage" | "sessionStorage"; key: string; points: number; status: string };

function storageSummaries(storage: Storage, area: StorageSummary["area"]): StorageSummary[] {
  const summaries: StorageSummary[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    try {
      const value = JSON.parse(storage.getItem(key) ?? "null") as unknown;
      const text = JSON.stringify(value);
      const pointMatches = text.match(/"(?:latitude|lat)"\s*:/g)?.length ?? 0;
      if (pointMatches > 0 || /flight|vol|trace|tracking/i.test(key)) summaries.push({ area, key, points: pointMatches, status: pointMatches > 0 ? "Trace potentielle" : "Clé liée au vol" });
    } catch {
      if (/flight|vol|trace|tracking/i.test(key)) summaries.push({ area, key, points: 0, status: "Valeur non JSON" });
    }
  }
  return summaries;
}

function coordinate(point: RecordedFlight["points"][number] | undefined): string {
  return point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : "—";
}

export default function FlightRecoveryWorkbench() {
  const [candidates, setCandidates] = useState<RecoveryCandidate[]>([]);
  const [storageKeys, setStorageKeys] = useState<StorageSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const inspect = useCallback(async () => {
    try {
      const storage = new IndexedDbRecordedFlightStorage();
      const [active, completed] = await Promise.all([storage.getActiveFlight(), storage.listFlights()]);
      const journalIds = new Set(loadFlightCompletionState().journalFlights.map(({ id }) => id));
      const unique = new Map<string, { flight: RecordedFlight; location: string }>();
      for (const flight of completed) unique.set(flight.id, { flight, location: "IndexedDB · balloon-companion-flights/flights" });
      if (active) unique.set(active.id, { flight: active, location: "IndexedDB · balloon-companion-flights/activeFlight/current" });
      const legacy = loadFlightSession();
      const legacyFlight = legacy ? legacyFlightSessionToRecordedFlight(legacy) : null;
      if (legacyFlight && !unique.has(legacyFlight.id)) unique.set(legacyFlight.id, { flight: legacyFlight, location: "localStorage · balloon_companion_flight_session" });
      setCandidates([...unique.values()].map((item) => ({ ...item, journalPresent: journalIds.has(item.flight.id) })));
      setStorageKeys([...storageSummaries(window.localStorage, "localStorage"), ...storageSummaries(window.sessionStorage, "sessionStorage")]);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Inspection impossible");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void inspect(); }, 0);
    return () => window.clearTimeout(timer);
  }, [inspect]);

  const restore = async (candidate: RecoveryCandidate) => {
    if (!window.confirm("Restaurer volontairement cette session dans le Journal ?\n\nL’opération est idempotente et ne supprime aucune donnée source.")) return;
    const lastTimestamp = candidate.flight.points.at(-1)?.timestamp ?? candidate.flight.updatedAt;
    const completed = candidate.flight.status === "COMPLETED" ? candidate.flight : finalizeRecordedFlight(candidate.flight, lastTimestamp);
    persistRecordedFlightInJournal(completed, { recovered: candidate.flight.status !== "COMPLETED" });
    await inspect();
  };

  return <main className={styles.page}>
    <header><p>DIAGNOSTIC LOCAL · DÉVELOPPEMENT</p><h1>Récupération des vols</h1><span>Lecture non destructive des stockages de cet appareil.</span></header>
    {error && <p className={styles.error}>{error}</p>}
    <section><h2>Sessions GPS IndexedDB</h2>{candidates.length === 0 ? <p>Aucune session RecordedFlight trouvée sur cet appareil.</p> : candidates.map((candidate) => {
      const end = candidate.flight.endedAt ?? candidate.flight.points.at(-1)?.timestamp ?? candidate.flight.updatedAt;
      const summary = calculateRecordedFlightSummary(candidate.flight.points, candidate.flight.startedAt, end);
      return <article key={candidate.flight.id} className={styles.card}>
        <div><strong>{new Date(candidate.flight.startedAt).toLocaleString("fr-FR")}</strong><span>{candidate.location}</span></div>
        <dl><div><dt>Début</dt><dd>{new Date(candidate.flight.startedAt).toLocaleTimeString("fr-FR")}</dd></div><div><dt>Fin proposée</dt><dd>{new Date(end).toLocaleTimeString("fr-FR")}</dd></div><div><dt>Durée</dt><dd>{Math.round(summary.durationSeconds / 60)} min</dd></div><div><dt>Points</dt><dd>{candidate.flight.points.length}</dd></div><div><dt>Distance</dt><dd>{(summary.distanceMeters / 1000).toFixed(1)} km</dd></div><div><dt>Statut</dt><dd>{candidate.flight.status}</dd></div><div><dt>Premier point</dt><dd>{coordinate(candidate.flight.points[0])}</dd></div><div><dt>Dernier point</dt><dd>{coordinate(candidate.flight.points.at(-1))}</dd></div><div><dt>Journal</dt><dd>{candidate.journalPresent ? "Présent" : "Absent"}</dd></div></dl>
        <details><summary>Prévisualiser</summary><p>Identifiant stable : {candidate.flight.id}</p><p>Altitude max : {summary.maxAltitudeMeters === null ? "—" : `${Math.round(summary.maxAltitudeMeters)} m`}</p></details>
        <button type="button" disabled={candidate.journalPresent} onClick={() => void restore(candidate)}>{candidate.journalPresent ? "Déjà restauré" : "Restaurer dans le Journal"}</button>
      </article>;
    })}</section>
    <section><h2>Autres clés inspectées</h2>{storageKeys.length === 0 ? <p>Aucune autre clé liée au vol détectée.</p> : <ul>{storageKeys.map((item) => <li key={`${item.area}-${item.key}`}><strong>{item.area}</strong> · {item.key} · {item.status}{item.points ? ` · ≈ ${item.points} points` : ""}</li>)}</ul>}</section>
  </main>;
}
