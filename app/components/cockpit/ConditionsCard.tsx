"use client";

import { ArrowUp, CloudSun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Card } from "../../design-system";
import type { ConditionsData } from "./types";
import styles from "./Cockpit.module.css";

type ConditionsCardProps = {
  data: ConditionsData;
};

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function subscribeToMinute(callback: () => void) {
  const interval = window.setInterval(callback, 60_000);
  return () => window.clearInterval(interval);
}

export default function ConditionsCard({ data }: ConditionsCardProps) {
  const isSunrise = useSyncExternalStore(
    subscribeToMinute,
    () => {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      return currentMinutes < timeToMinutes(data.sunrise);
    },
    () => false,
  );

  return (
    <Card className={styles.card}>
      <h2 className={styles.cardTitle}>
        <CloudSun size={15} aria-hidden="true" />
        Conditions
      </h2>

      <div className={styles.conditionDirection}>
        <span>Direction du vent</span>
        <strong>
          <ArrowUp
            size={18}
            style={{ transform: `rotate(${data.windDirectionDeg}deg)` }}
            aria-hidden="true"
          />
          {data.windDirectionDeg}°
        </strong>
      </div>

      <div className={styles.conditionMetrics}>
        <div>
          <span>Vent</span>
          <strong>{data.wind}</strong>
        </div>
        <div>
          <span>Rafales</span>
          <strong>{data.gusts}</strong>
        </div>
        <div>
          <span>Température</span>
          <strong>{data.temperature}</strong>
        </div>
      </div>

      <div className={styles.sunEvent}>
        <span>{isSunrise ? "Lever" : "Coucher"}</span>
        <strong>{isSunrise ? data.sunrise : data.sunset}</strong>
      </div>
    </Card>
  );
}
