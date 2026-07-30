import { BadgeCheck } from "lucide-react";
import { Card } from "../../design-system";
import type { PilotStatusData } from "./types";
import styles from "./Cockpit.module.css";

type PilotStatusCardProps = {
  data: PilotStatusData;
};

export default function PilotStatusCard({ data }: PilotStatusCardProps) {
  const rows = [data.flightTest, data.medical].filter(
    (status) => status !== null,
  );

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>
        <BadgeCheck size={15} aria-hidden="true" />
        Statut pilote
      </h2>
      <div className={styles.rows}>
        {rows.map((status) => (
          <div className={styles.credentialRow} key={status.label}>
            <span className={styles.credentialLabel}>{status.label}</span>
            <strong className={styles.credentialRemaining}>
              {status.remainingMonths} mois restants
            </strong>
            <span className={styles.credentialDueDate}>
              Échéance&nbsp;: {status.dueDate}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
