import Link from "next/link";
import { Route } from "lucide-react";
import { Card } from "../../design-system";
import FlightRouteThumbnail from "./FlightRouteThumbnail";
import type { LastFlightData } from "./types";
import styles from "./Cockpit.module.css";

type LastFlightCardProps = {
  data: LastFlightData;
  href: string;
};

export default function LastFlightCard({ data, href }: LastFlightCardProps) {
  return (
    <Link
      className={styles.cardLink}
      href={href}
      aria-label={`Ouvrir le dernier vol du ${data.date}`}
    >
      <Card className={`${styles.card} ${styles.summaryCard}`}>
        <h2 className={styles.cardTitle}>
          <Route size={15} aria-hidden="true" />
          Dernier vol
        </h2>
        <FlightRouteThumbnail route={data.route} />
        <div className={styles.flightSummary}>
          <p className={styles.summaryLead}>{data.date}</p>
          <p className={styles.routeLabel}>
            {data.departure} → {data.arrival}
          </p>
          <div className={styles.inlineMetrics}>
            <span>{data.duration}</span>
            <span aria-hidden="true">•</span>
            <span>{data.distance}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
