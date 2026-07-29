import { Card } from "../../design-system";
import type { WeeklyActivityData } from "./types";
import styles from "./Cockpit.module.css";

type WeeklyActivityCardProps = {
  data: WeeklyActivityData;
};

export default function WeeklyActivityCard({
  data,
}: WeeklyActivityCardProps) {
  return (
    <Card className={`${styles.card} ${styles.summaryCard}`}>
      <h2 className={styles.cardTitle}>Cette semaine</h2>
      <p className={styles.summaryLead}>{data.hours}</p>
      <div className={styles.summaryMeta}>
        <div className={styles.summaryMetric}>
          <span>Vols</span>
          <strong>{data.flights}</strong>
        </div>
        <div className={styles.summaryMetric}>
          <span>Heures</span>
          <strong>{data.hours}</strong>
        </div>
        <div className={styles.summaryMetric}>
          <span>Temps cumulé</span>
          <strong>{data.cumulativeTime}</strong>
        </div>
      </div>
    </Card>
  );
}
