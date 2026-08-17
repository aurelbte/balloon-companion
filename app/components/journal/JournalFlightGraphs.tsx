"use client";
import Link from "next/link";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import type { JournalFlight } from "../../lib/journalMockData";
import NavigationBar from "../NavigationBar";
import styles from "../../journal/Journal.module.css";
import JournalChart from "./JournalChart";
import { useRecordedFlightJournalPoints } from "../../hooks/useRecordedFlightJournalPoints";
import { useUnitPreferences } from "../../contexts/UnitPreferencesContext";
import { kmhToKnots, metresToFeet } from "../../lib/unitPreferences";

export default function JournalFlightGraphs({ flightId, initialFlight }: { flightId: string; initialFlight: JournalFlight | null }) {
  const state = useFlightCompletionState();
  const flight = state.journalFlights.find(({ id }) => id === flightId) ?? initialFlight;
  if (!flight) return <main className={styles.screen}><div className={styles.layout}><Link href="/journal">← Journal</Link><p>Vol introuvable.</p></div></main>;
  return <HydratedGraphs flight={flight} />;
}

function HydratedGraphs({ flight }: { flight: JournalFlight }) {
  const units = useUnitPreferences();
  const points = useRecordedFlightJournalPoints(flight);
  const altitude = points.filter((point): point is typeof point & { altitudeM: number } => point.altitudeM !== null).map((point) => ({ x: point.elapsedMinutes, y: units.flightInstruments.altitudeUnit === "ft" ? metresToFeet(point.altitudeM) : point.altitudeM }));
  const speed = points.map((point) => ({ x: point.elapsedMinutes, y: point.speedKmh === null ? null : units.flightInstruments.speedUnit === "kt" ? kmhToKnots(point.speedKmh) : point.speedKmh }));
  const availableSpeeds = speed.flatMap(({ y }) => y === null ? [] : [y]);
  const durationMinutes = Math.max(...points.map(({ elapsedMinutes }) => elapsedMinutes), flight.durationMinutes, 1);
  const altitudeStep = units.flightInstruments.altitudeUnit === "ft" ? 500 : 250;
  const altitudeMinimum = units.flightInstruments.altitudeUnit === "ft" ? 3000 : 1000;
  return <main className={styles.screen}><div className={styles.layout}><Link href={`/journal/${flight.id}`} className={styles.backLink}>← Fiche de vol</Link><header className={styles.detailHeader}><p className={styles.eyebrow}>Graphiques</p><h1 className={styles.routeTitle}>{flight.departure} → {flight.arrival}</h1><p className={styles.dateLine}>{flight.date}</p></header><div className={styles.graphs}>{altitude.length > 1 ? <JournalChart title="Altitude" unit={`${units.flightInstruments.altitudeUnit} AMSL`} axisUnit={units.flightInstruments.altitudeUnit} color="var(--bc-color-navigation-strong)" yMaximum={Math.max(altitudeMinimum, Math.ceil(Math.max(...altitude.map(({ y }) => y)) / altitudeStep) * altitudeStep)} yStep={altitudeStep} durationMinutes={durationMinutes} tooltipLabel="ALTITUDE" tooltipUnavailableLabel="Altitude indisponible" tooltipFractionDigits={0} points={altitude} /> : <p>Altitude indisponible</p>}{availableSpeeds.length > 1 ? <JournalChart title="Vitesse sol" unit={units.flightInstruments.speedUnit} axisUnit={units.flightInstruments.speedUnit} color="var(--bc-color-launch)" yMaximum={Math.max(30, Math.ceil(Math.max(...availableSpeeds) / 5) * 5)} yStep={5} durationMinutes={durationMinutes} tooltipLabel="VITESSE" tooltipUnavailableLabel="Vitesse indisponible" tooltipFractionDigits={1} points={speed} /> : <p>Vitesse indisponible</p>}</div></div><NavigationBar activeItem="Journal" /></main>;
}
