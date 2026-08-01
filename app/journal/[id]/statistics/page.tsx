import Link from "next/link";
import { notFound } from "next/navigation";
import NavigationBar from "../../../components/NavigationBar";
import JournalFlightTitle from "../../../components/journal/JournalFlightTitle";
import {
  getJournalFlightAutomaticName,
  getJournalFlight,
  JOURNAL_FLIGHTS,
} from "../../../lib/journalMockData";
import styles from "../../Journal.module.css";
import { createDemoCompletionJournalFlight, DEMO_COMPLETION_FLIGHT_ID } from "../../../lib/flightCompletion";

type JournalStatisticsPageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return [...JOURNAL_FLIGHTS.map((flight) => ({ id: flight.id })), { id: DEMO_COMPLETION_FLIGHT_ID }];
}

function decimal(value: number): string {
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

export default async function JournalStatisticsPage({
  params,
}: JournalStatisticsPageProps) {
  const { id } = await params;
  const flight = getJournalFlight(id) ?? (id === DEMO_COMPLETION_FLIGHT_ID ? createDemoCompletionJournalFlight() : null);
  if (!flight) notFound();
  const stats = flight.statistics;
  const values = [
    ["Décollage", flight.takeoffTime],
    ["Atterrissage", flight.landingTime],
    ["Durée", `${flight.durationMinutes} min`],
    ["Distance parcourue", `${decimal(flight.distanceKm)} km`],
    ["Altitude au décollage", `${stats.takeoffAltitudeAmslM} m AMSL`],
    ["Altitude à l’atterrissage", `${stats.landingAltitudeAmslM} m AMSL`],
    ["Altitude maximale", `${flight.maxAltitudeM} m AMSL`],
    ["Altitude moyenne", `${stats.averageAltitudeAmslM} m AMSL`],
    ["Vitesse maximale", `${flight.maxSpeedKmh} km/h`],
    ["Vitesse moyenne", `${decimal(stats.averageSpeedKmh)} km/h`],
    ["Vitesse minimale en vol", `${decimal(stats.minimumInFlightSpeedKmh)} km/h`],
    ["Taux de montée maximal", `+${decimal(stats.maximumClimbRateMps)} m/s`],
    ["Taux de descente maximal", `−${decimal(Math.abs(stats.maximumDescentRateMps))} m/s`],
    ["Cap moyen", `${stats.averageHeadingDeg}°`],
    ["Distance directe départ-arrivée", `${decimal(stats.directDistanceKm)} km`],
  ] as const;

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <Link href={`/journal/${flight.id}`} className={styles.backLink}>
          ← Fiche de vol
        </Link>
        <header className={styles.detailHeader}>
          <p className={styles.eyebrow}>Statistiques</p>
          <JournalFlightTitle
            flightId={flight.id}
            automaticName={getJournalFlightAutomaticName(flight)}
            availableFlightIds={[...JOURNAL_FLIGHTS.map((item) => item.id), DEMO_COMPLETION_FLIGHT_ID]}
            className={styles.routeTitle}
          />
          <p className={styles.dateLine}>{flight.date}</p>
        </header>

        <section className={styles.statisticsGrid} aria-label="Statistiques du vol">
          {values.map(([label, value]) => (
            <article key={label} className={styles.statisticCard}>
              <h2 className={styles.statisticLabel}>{label}</h2>
              <p className={styles.statisticValue}>{value}</p>
            </article>
          ))}
        </section>
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}
