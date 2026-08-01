"use client";

import Link from "next/link";
import { Balloon as BalloonIcon } from "lucide-react";
import { Card } from "../../design-system";
import { useActiveBalloon } from "../../hooks/useBalloons";
import styles from "./Cockpit.module.css";

type MyBalloonsCardProps = { href: string };

export default function MyBalloonsCard({
  href,
}: MyBalloonsCardProps) {
  const primary = useActiveBalloon();

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
      aria-label={`Ouvrir Mes ballons, ${primary.registration}`}
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
