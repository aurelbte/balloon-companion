"use client";

import { Moon, Star, Sunrise } from "lucide-react";
import Link from "next/link";
import { Card } from "../../design-system";
import { useWeatherPreferences } from "../../contexts/WeatherPreferencesContext";
import { WEATHER_ICONS } from "../../weather/presentation";
import styles from "./Cockpit.module.css";

type ConditionsCardProps = {
  href: string;
  sunrise: string;
  sunset: string;
};

export default function ConditionsCard({ href, sunrise, sunset }: ConditionsCardProps) {
  const preferences = useWeatherPreferences();
  const point = preferences.selectedPoint;
  const Icon = point ? WEATHER_ICONS[point.weatherCode] : null;
  return (
    <Link className={styles.cardLink} href={href} aria-label="Ouvrir la météo">
      <Card className={`${styles.card} ${styles.weatherCard}`}>
        <div className={styles.weatherHeader}>
          <h2 className={styles.cardTitle}>Météo</h2>
          <div className={styles.sunTimes} aria-label="Lever et coucher du soleil">
            <span><Sunrise size={11} aria-hidden="true" />{sunrise}</span>
            <span><Moon size={10} aria-hidden="true" />{sunset}</span>
          </div>
        </div>
        <div className={styles.weatherLocation}>
          <span>Aérodrome favori <Star size={11} fill="currentColor" aria-hidden="true" /></span>
          <strong>{preferences.activeFavorite?.name ?? "Aucun lieu sélectionné"}{preferences.modelName ? ` · ${preferences.modelName}` : ""}</strong>
        </div>
        <div className={styles.hourlyForecast} aria-label="Prévision météo heure par heure">
          <div><strong>{preferences.selectedDay ?? "—"}</strong><small>Jour</small></div>
          <div><strong>{preferences.selectedTime ?? "—"}</strong><small>Heure</small></div>
          <div>{Icon && <Icon size={16} aria-hidden="true" />}<span>{point?.temperatureC === undefined ? "—" : `${point.temperatureC}°C`}</span></div>
          <div><strong>{point?.windSpeedKmh === undefined ? "—" : `${point.windSpeedKmh}`}</strong><small>km/h</small></div>
        </div>
        <span className={styles.cardAction}>Voir le détail météo →</span>
      </Card>
    </Link>
  );
}
