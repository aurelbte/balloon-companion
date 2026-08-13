"use client";

import { Moon, Navigation, Star, Sunrise } from "lucide-react";
import Link from "next/link";
import { Card } from "../../design-system";
import { useWeatherPreferences } from "../../contexts/WeatherPreferencesContext";
import { WeatherIcon } from "../../weather/presentation";
import { relativeUpdateLabel } from "../../lib/weather/weatherSelection";
import { windArrowRotationDegrees } from "../../weather/windArrow";
import styles from "./Cockpit.module.css";
import { cockpitWindDirection, cockpitWindSpeed } from "./weatherCardPresentation";

export default function ConditionsCard({ href }: { href: string }) {
  const preferences = useWeatherPreferences();
  const point = preferences.selectedPoint;
  return (
    <Link className={styles.cardLink} href={href} aria-label="Ouvrir la météo">
      <Card className={`${styles.card} ${styles.weatherCard}`}>
        <div className={styles.weatherHeader}>
          <h2 className={styles.cardTitle}>Météo</h2>
          <div className={styles.sunTimes} aria-label="Lever et coucher du soleil">
            <span><Sunrise size={11} aria-hidden="true" />{preferences.sunTimes?.sunrise ?? "—"}</span>
            <span><Moon size={10} aria-hidden="true" />{preferences.sunTimes?.sunset ?? "—"}</span>
          </div>
        </div>
        <div className={styles.weatherLocation}>
          {point && <WeatherIcon code={point.weatherCode} size={22} />}
          <div><span>Lieu favori <Star size={11} fill="currentColor" aria-hidden="true" /></span><strong>{preferences.activeFavorite?.name ?? "Aucun lieu sélectionné"}</strong><small>{preferences.modelName || "Aucun modèle"}</small></div>
        </div>
        <div className={styles.cockpitWeatherMetrics}>
          <div className={styles.cockpitWind}><Navigation size={18} aria-hidden="true" style={{ transform: `rotate(${windArrowRotationDegrees(point?.windDirectionDeg)}deg)` }} /><strong>{cockpitWindDirection(point?.windDirectionDeg)}</strong><b>{cockpitWindSpeed(point?.windSpeedKmh)}</b></div>
          <div><span>Rafales</span><strong>{cockpitWindSpeed(point?.windGustKmh)}</strong></div>
          <div><span>Température</span><strong>{point?.temperatureC === undefined ? "—" : `${point.temperatureC}°C`}</strong></div>
        </div>
        <div className={styles.weatherFooter}><span className={styles.cardAction}>Voir le détail météo →</span>{point && <small>{relativeUpdateLabel(point.sourceUpdatedAt)}</small>}</div>
      </Card>
    </Link>
  );
}
