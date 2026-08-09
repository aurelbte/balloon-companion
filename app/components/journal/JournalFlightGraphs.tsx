"use client";
import Link from "next/link";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import type { JournalFlight } from "../../lib/journalMockData";
import NavigationBar from "../NavigationBar";
import styles from "../../journal/Journal.module.css";
import JournalChart from "./JournalChart";
import { useRecordedFlightJournalPoints } from "../../hooks/useRecordedFlightJournalPoints";

export default function JournalFlightGraphs({ flightId, initialFlight }: { flightId: string; initialFlight: JournalFlight | null }) {
  const state = useFlightCompletionState();
  const flight = state.journalFlights.find(({ id }) => id === flightId) ?? initialFlight;
  if (!flight) return <main className={styles.screen}><div className={styles.layout}><Link href="/journal">← Journal</Link><p>Vol introuvable.</p></div></main>;
  return <HydratedGraphs flight={flight} />;
}

function HydratedGraphs({ flight }: { flight: JournalFlight }) {
  const points = useRecordedFlightJournalPoints(flight);
  const altitude = points.filter((point): point is typeof point & { altitudeM: number } => point.altitudeM !== null).map((point) => ({ x: point.elapsedMinutes, y: point.altitudeM }));
  const speed = points.filter((point): point is typeof point & { speedKmh: number } => point.speedKmh !== null).map((point) => ({ x: point.elapsedMinutes, y: point.speedKmh }));
  return <main className={styles.screen}><div className={styles.layout}><Link href={`/journal/${flight.id}`} className={styles.backLink}>← Fiche de vol</Link><header className={styles.detailHeader}><p className={styles.eyebrow}>Graphiques</p><h1 className={styles.routeTitle}>{flight.departure} → {flight.arrival}</h1><p className={styles.dateLine}>{flight.date}</p></header><div className={styles.graphs}>{altitude.length > 1 ? <JournalChart title="Altitude" unit="m AMSL" axisUnit="m" color="var(--bc-color-navigation-strong)" yMaximum={Math.max(1000, Math.ceil(Math.max(...altitude.map(({ y }) => y)) / 250) * 250)} yStep={250} points={altitude} /> : <p>Altitude indisponible</p>}{speed.length > 1 ? <JournalChart title="Vitesse sol" unit="km/h" axisUnit="km/h" color="var(--bc-color-launch)" yMaximum={Math.max(30, Math.ceil(Math.max(...speed.map(({ y }) => y)) / 5) * 5)} yStep={5} points={speed} /> : <p>Vitesse indisponible</p>}</div></div><NavigationBar activeItem="Journal" /></main>;
}
