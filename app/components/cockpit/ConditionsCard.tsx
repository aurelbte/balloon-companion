import { CloudSun } from "lucide-react";
import { Card } from "../../design-system";
import type { ConditionsData } from "./types";
import styles from "./Cockpit.module.css";

type ConditionsCardProps = {
  data: ConditionsData;
};

export default function ConditionsCard({ data }: ConditionsCardProps) {
  const rows = [
    ["Vent moyen", data.meanWind],
    ["Rafales", data.gusts],
    ["Lever soleil", data.sunrise],
    [data.modelName, data.modelTime],
  ] as const;

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>
        <CloudSun size={15} aria-hidden="true" />
        Conditions
      </h2>
      <div className={styles.rows}>
        {rows.map(([label, value], index) => (
          <div
            className={`${styles.row} ${index === 1 ? styles.gustRow : ""}`}
            key={label}
          >
            <span className={styles.label}>{label}</span>
            <strong className={styles.value}>{value}</strong>
          </div>
        ))}
      </div>
    </Card>
  );
}
