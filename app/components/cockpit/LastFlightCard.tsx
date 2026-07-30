import Link from "next/link";
import { Route } from "lucide-react";
import { Card } from "../../design-system";
import type { LastFlightData } from "./types";
import styles from "./Cockpit.module.css";

type LastFlightCardProps = {
  data: LastFlightData | null;
  href: string;
};

export default function LastFlightCard({ data, href }: LastFlightCardProps) {
  if (!data) {
    return (
      <Card className={`${styles.card} ${styles.summaryCard}`}>
        <h2 className={styles.cardTitle}>
          <Route size={15} aria-hidden="true" />
          Dernier vol
        </h2>
        <p className={styles.unavailableCard}>Information indisponible</p>
      </Card>
    );
  }

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
        <div className={styles.lastFlightDetails}>
          <div>
            <span>Date</span>
            <strong>{data.date}</strong>
          </div>
          <div>
            <span>Durée</span>
            <strong>{data.duration}</strong>
          </div>
          <div>
            <span>Trajet</span>
            <strong>
              {data.departure} → {data.arrival}
            </strong>
          </div>
        </div>
        <span className={styles.cardAction}>Voir le journal →</span>
      </Card>
    </Link>
  );
}
