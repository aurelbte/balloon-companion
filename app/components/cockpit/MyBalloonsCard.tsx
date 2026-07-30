import Link from "next/link";
import { Balloon as BalloonIcon } from "lucide-react";
import { Card } from "../../design-system";
import type { Balloon } from "./types";
import styles from "./Cockpit.module.css";

type MyBalloonsCardProps = {
  balloons: readonly Balloon[];
  href: string;
};

export default function MyBalloonsCard({
  balloons,
  href,
}: MyBalloonsCardProps) {
  const primary =
    balloons.find((balloon) => balloon.isFavorite) ?? balloons.at(0);

  if (!primary) {
    return (
      <Card className={`${styles.card} ${styles.summaryCard}`}>
        <h2 className={styles.cardTitle}>
          <BalloonIcon size={15} aria-hidden="true" />
          Mes ballons
        </h2>
        <p className={styles.unavailableCard}>Information indisponible</p>
      </Card>
    );
  }

  return (
    <Link
      className={styles.cardLink}
      href={href}
      aria-label={`Ouvrir Mes ballons, ${balloons.length} ballon${balloons.length > 1 ? "s" : ""}`}
    >
      <Card className={`${styles.card} ${styles.summaryCard}`}>
        <h2 className={styles.cardTitle}>
          <BalloonIcon size={15} aria-hidden="true" />
          Mes ballons
        </h2>
        <div className={styles.activeBalloon}>
          <strong>
            {primary.manufacturer} {primary.model}
          </strong>
          <span>Ballon actif</span>
        </div>
        <span className={styles.cardAction}>Voir mes ballons →</span>
      </Card>
    </Link>
  );
}
