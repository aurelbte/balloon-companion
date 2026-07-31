import Link from "next/link";
import { notFound } from "next/navigation";
import JournalChart from "../../../components/journal/JournalChart";
import NavigationBar from "../../../components/NavigationBar";
import {
  getJournalFlight,
  JOURNAL_FLIGHTS,
} from "../../../lib/journalMockData";
import styles from "../../Journal.module.css";

type JournalGraphsPageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return JOURNAL_FLIGHTS.map((flight) => ({ id: flight.id }));
}

export default async function JournalGraphsPage({
  params,
}: JournalGraphsPageProps) {
  const { id } = await params;
  const flight = getJournalFlight(id);
  if (!flight) notFound();

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <Link href={`/journal/${flight.id}`} className={styles.backLink}>
          ← Fiche de vol
        </Link>
        <header className={styles.detailHeader}>
          <p className={styles.eyebrow}>Graphiques</p>
          <h1 className={styles.routeTitle}>
            {flight.departure} → {flight.arrival}
          </h1>
          <p className={styles.dateLine}>{flight.date}</p>
        </header>

        <div className={styles.graphs}>
          <JournalChart
            title="Altitude"
            unit="m AMSL"
            axisUnit="m"
            color="var(--bc-color-navigation-strong)"
            yMaximum={1000}
            yStep={250}
            points={flight.points.map((point) => ({
              x: point.elapsedMinutes,
              y: point.altitudeM,
            }))}
          />
          <JournalChart
            title="Vitesse sol"
            unit="km/h"
            axisUnit="km/h"
            color="var(--bc-color-launch)"
            yMaximum={30}
            yStep={5}
            points={flight.points.map((point) => ({
              x: point.elapsedMinutes,
              y: point.speedKmh,
            }))}
          />
        </div>
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}
