import { BadgeCheck } from "lucide-react";
import { Card } from "../../design-system";
import type { PilotStatusData } from "./types";
import styles from "./Cockpit.module.css";

type PilotStatusCardProps = {
  data: PilotStatusData;
};

export default function PilotStatusCard({ data }: PilotStatusCardProps) {
  const rows = [
    ["Licence", data.licence, "valid"],
    ["Médical", data.medical, "valid"],
    ["Prochain contrôle", data.nextCheck, "information"],
  ] as const;

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>
        <BadgeCheck size={15} aria-hidden="true" />
        Statut pilote
      </h2>
      <div className={styles.rows}>
        {rows.map(([label, value, status]) => (
          <div className={styles.row} key={label}>
            <span className={styles.label}>{label}</span>
            <span className={styles.statusValue} data-status={status}>
              <span className={styles.statusDot} aria-hidden="true" />
              <strong>{value}</strong>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
