"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import JournalTraceThumbnail from "../../components/journal/JournalTraceThumbnail";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import {
  createDemoCompletionJournalFlight,
  DEMO_COMPLETION_FLIGHT_ID,
} from "../../lib/flightCompletion";
import { ensureDemoCompletionPersisted } from "../../lib/flightCompletionStorage";
import styles from "./FlightComplete.module.css";

export default function FlightCompletePage() {
  const router = useRouter();
  const state = useFlightCompletionState();
  const flight = createDemoCompletionJournalFlight();
  const storedFlight = state.journalFlights.find(({ id }) => id === DEMO_COMPLETION_FLIGHT_ID);

  useEffect(() => {
    const demoEnabled = process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("demo") === "1";
    if (demoEnabled) ensureDemoCompletionPersisted();
    else router.replace("/journal");
  }, [router]);

  const leaveForLater = () => {
    window.sessionStorage.setItem("balloon-companion-journal-view", "flights");
    router.push("/journal");
  };

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <header>
          <p className={styles.eyebrow}>Fin de vol</p>
          <h1 className={styles.title}>Vol terminé</h1>
          <p className={styles.route}>LFQO → Mérignies</p>
        </header>

        <Link href={`/journal/${DEMO_COMPLETION_FLIGHT_ID}`} className={styles.traceCard} aria-label="Ouvrir la trace détaillée">
          <JournalTraceThumbnail points={flight.points} label="Trace LFQO vers Mérignies" />
        </Link>

        <section className={styles.metrics} aria-label="Résumé du vol">
          <p className={styles.metric}><strong>57 min</strong><span>Durée GPS</span></p>
          <p className={styles.metric}><strong>17,8 km</strong><span>Distance</span></p>
          <p className={styles.metric}><strong>982 m</strong><span>Altitude max</span></p>
        </section>

        <section className={styles.statusCard} aria-label="État d’enregistrement">
          <p>Journal<strong>Enregistré</strong></p>
          <p>Carnet d’ascensions<strong>{storedFlight?.logbookStatus === "VALIDATED" ? "Validé" : "À valider"}</strong></p>
        </section>

        <Link href="/flight/complete/ascension" className={styles.logbookCard}>
          <div><h2>Carnet d’ascensions</h2><p>57 min proposées</p></div>
          <span>{storedFlight?.logbookStatus === "VALIDATED" ? "Consulter →" : "À valider →"}</span>
        </Link>

        <div className={styles.actions}>
          <button type="button" onClick={leaveForLater}>Plus tard</button>
          <Link href="/flight/complete/ascension">Valider l’ascension</Link>
        </div>
      </div>
    </main>
  );
}
