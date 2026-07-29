import Link from "next/link";
import { Balloon as BalloonIcon } from "lucide-react";
import { Card } from "../../design-system";
import type { Balloon } from "./types";
import styles from "./Cockpit.module.css";

type MyBalloonsCardProps = {
  balloons: readonly Balloon[];
  href: string;
};

function getDocumentSummary(balloon: Balloon) {
  if (balloon.documents.some((document) => document.status === "expired")) {
    return { label: "Document expiré", status: "danger" };
  }
  if (
    balloon.documents.some(
      (document) =>
        document.status === "expiring" || document.status === "missing",
    )
  ) {
    return { label: "Document à vérifier", status: "warning" };
  }
  return { label: "Documents à jour", status: "valid" };
}

export default function MyBalloonsCard({
  balloons,
  href,
}: MyBalloonsCardProps) {
  const primary =
    balloons.find((balloon) => balloon.isFavorite) ?? balloons.at(0);

  if (!primary) {
    return null;
  }

  const documentSummary = getDocumentSummary(primary);
  const secondaryRegistrations = balloons
    .filter((balloon) => balloon.id !== primary.id)
    .slice(0, 1);
  const remainingCount = Math.max(balloons.length - 2, 0);

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
        <div className={styles.balloonIdentity}>
          <strong className={styles.balloonRegistration}>
            {primary.registration}
          </strong>
          <span className={styles.balloonModel}>
            {primary.manufacturer} {primary.model}
          </span>
        </div>
        <div
          className={styles.documentStatus}
          data-status={documentSummary.status}
        >
          <span className={styles.statusDot} aria-hidden="true" />
          {documentSummary.label}
        </div>
        <div className={styles.balloonFooter}>
          <span>
            {balloons.length} ballon{balloons.length > 1 ? "s" : ""}
          </span>
          <span className={styles.registrationStack}>
            {secondaryRegistrations.map((balloon) => (
              <span key={balloon.id}>{balloon.registration}</span>
            ))}
            {remainingCount > 0 && <span>+{remainingCount}</span>}
          </span>
        </div>
      </Card>
    </Link>
  );
}
