import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BarChart3,
  ChevronRight,
  FileDown,
  Gauge,
  NotebookPen,
} from "lucide-react";
import NavigationBar from "../../components/NavigationBar";
import JournalFlightMap from "../../components/journal/JournalFlightMap";
import {
  getJournalFlight,
  JOURNAL_FLIGHTS,
} from "../../lib/journalMockData";
import styles from "../Journal.module.css";

type JournalFlightPageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return JOURNAL_FLIGHTS.map((flight) => ({ id: flight.id }));
}

export default async function JournalFlightPage({
  params,
}: JournalFlightPageProps) {
  const { id } = await params;
  const flight = getJournalFlight(id);
  if (!flight) notFound();

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <Link href="/journal" className={styles.backLink}>
          ← Journal
        </Link>

        <header className={styles.detailHeader}>
          <h1 className={styles.routeTitle}>
            {flight.departure} → {flight.arrival}
          </h1>
          <p className={styles.dateLine}>{flight.date}</p>
          <div className={styles.primaryMetrics}>
            <p>
              <span>Durée</span>
              <strong>{flight.durationMinutes} min</strong>
            </p>
            <p>
              <span>Distance</span>
              <strong>{flight.distanceKm.toFixed(1)} km</strong>
            </p>
          </div>
        </header>

        <JournalFlightMap flight={flight} />

        <section className={styles.moduleGrid} aria-label="Informations du vol">
          <Link
            href={`/journal/${flight.id}/graphs`}
            className={`${styles.moduleCard} ${styles.moduleLink}`}
            aria-label={`Voir les graphiques du vol ${flight.departure} vers ${flight.arrival}`}
          >
            <h2 className={styles.moduleTitle}>
              <BarChart3 size={16} aria-hidden="true" /> Graphiques
            </h2>
            <p className={styles.moduleValue}>Altitude · Vitesse</p>
            <p className={styles.moduleAction}>
              <span>Voir les graphiques</span>
              <ChevronRight size={15} aria-hidden="true" />
            </p>
          </Link>

          <Link
            href={`/journal/${flight.id}/statistics`}
            className={`${styles.moduleCard} ${styles.moduleLink}`}
            aria-label={`Voir toutes les statistiques du vol ${flight.departure} vers ${flight.arrival}`}
          >
            <h2 className={styles.moduleTitle}>
              <Gauge size={16} aria-hidden="true" /> Statistiques
            </h2>
            <div className={styles.statGrid}>
              <p><span>Départ</span><strong>{flight.takeoffTime}</strong></p>
              <p><span>Arrivée</span><strong>{flight.landingTime}</strong></p>
              <p><span>Altitude max</span><strong>{flight.maxAltitudeM} m</strong></p>
              <p><span>Vitesse max</span><strong>{flight.maxSpeedKmh} km/h</strong></p>
            </div>
            <p className={styles.moduleAction}>
              <span>Voir toutes les statistiques</span>
              <ChevronRight size={15} aria-hidden="true" />
            </p>
          </Link>

          <article className={styles.moduleCard}>
            <h2 className={styles.moduleTitle}>
              <NotebookPen size={16} aria-hidden="true" /> Notes
            </h2>
            <p className={styles.moduleValue}>{flight.notes ?? "Aucune note"}</p>
          </article>

          <article className={styles.moduleCard}>
            <h2 className={styles.moduleTitle}>
              <FileDown size={16} aria-hidden="true" /> Export
            </h2>
            <p className={styles.moduleValue}>GPX · PDF</p>
            <p className={styles.moduleHint}>Formats du carnet de vol</p>
          </article>
        </section>
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}
