"use client";
import Link from "next/link";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import type { JournalFlight } from "../../lib/journalMockData";
import NavigationBar from "../NavigationBar";
import styles from "../../journal/Journal.module.css";

const value = (number: number | null, unit: string, sign = false) => number === null ? "—" : `${sign && number > 0 ? "+" : ""}${number.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${unit}`;

export default function JournalFlightStatistics({ flightId, initialFlight }: { flightId: string; initialFlight: JournalFlight | null }) {
  const state = useFlightCompletionState();
  const flight = state.journalFlights.find(({ id }) => id === flightId) ?? initialFlight;
  if (!flight) return <main className={styles.screen}><div className={styles.layout}><Link href="/journal">← Journal</Link><p>Vol introuvable.</p></div></main>;
  const stats = flight.statistics;
  const values = [["Décollage", flight.takeoffTime], ["Atterrissage", flight.landingTime], ["Durée", `${flight.durationMinutes} min`], ["Distance parcourue", `${flight.distanceKm.toFixed(1)} km`], ["Altitude au décollage", value(stats.takeoffAltitudeAmslM, "m AMSL")], ["Altitude à l’atterrissage", value(stats.landingAltitudeAmslM, "m AMSL")], ["Altitude maximale", value(flight.maxAltitudeM, "m AMSL")], ["Altitude moyenne", value(stats.averageAltitudeAmslM, "m AMSL")], ["Vitesse maximale", value(flight.maxSpeedKmh, "km/h")], ["Vitesse moyenne", value(stats.averageSpeedKmh, "km/h")], ["Vitesse minimale en vol", value(stats.minimumInFlightSpeedKmh, "km/h")], ["Taux de montée maximal", value(stats.maximumClimbRateMps, "m/s", true)], ["Taux de descente maximal", value(stats.maximumDescentRateMps, "m/s")], ["Cap moyen", value(stats.averageHeadingDeg, "°")], ["Distance directe départ-arrivée", `${stats.directDistanceKm.toFixed(1)} km`]] as const;
  return <main className={styles.screen}><div className={styles.layout}><Link href={`/journal/${flight.id}`} className={styles.backLink}>← Fiche de vol</Link><header className={styles.detailHeader}><p className={styles.eyebrow}>Statistiques</p><h1 className={styles.routeTitle}>{flight.departure} → {flight.arrival}</h1><p className={styles.dateLine}>{flight.date}</p></header><section className={styles.statisticsGrid}>{values.map(([label, displayed]) => <article key={label} className={styles.statisticCard}><h2 className={styles.statisticLabel}>{label}</h2><p className={styles.statisticValue}>{displayed}</p></article>)}</section></div><NavigationBar activeItem="Journal" /></main>;
}
