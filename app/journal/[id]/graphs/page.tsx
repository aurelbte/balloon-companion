import Link from "next/link";
import { notFound } from "next/navigation";
import JournalChart from "../../../components/journal/JournalChart";
import JournalFlightTitle from "../../../components/journal/JournalFlightTitle";
import NavigationBar from "../../../components/NavigationBar";
import {
  getJournalFlightAutomaticName,
  getJournalFlight,
  JOURNAL_FLIGHTS,
} from "../../../lib/journalMockData";
import styles from "../../Journal.module.css";
import { createDemoCompletionJournalFlight, DEMO_COMPLETION_FLIGHT_ID } from "../../../lib/flightCompletion";

type JournalGraphsPageProps = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return [...JOURNAL_FLIGHTS.map((flight) => ({ id: flight.id })), { id: DEMO_COMPLETION_FLIGHT_ID }];
}

export default async function JournalGraphsPage({
  params,
}: JournalGraphsPageProps) {
  const { id } = await params;
  const flight = getJournalFlight(id) ?? (id === DEMO_COMPLETION_FLIGHT_ID ? createDemoCompletionJournalFlight() : null);
  if (!flight) notFound();

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <Link href={`/journal/${flight.id}`} className={styles.backLink}>
          ← Fiche de vol
        </Link>
        <header className={styles.detailHeader}>
          <p className={styles.eyebrow}>Graphiques</p>
          <JournalFlightTitle
            flightId={flight.id}
            automaticName={getJournalFlightAutomaticName(flight)}
            availableFlightIds={[...JOURNAL_FLIGHTS.map((item) => item.id), DEMO_COMPLETION_FLIGHT_ID]}
            className={styles.routeTitle}
          />
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
