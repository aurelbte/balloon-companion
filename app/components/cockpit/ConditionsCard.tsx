"use client";

import { Cloud, CloudSun, Moon, Star, Sun, Sunrise } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "../../design-system";
import { useWeatherPreferences } from "../../contexts/WeatherPreferencesContext";
import { loadFavoriteLaunchSites } from "../../lib/favoriteLaunchSites";
import { SUPPORTED_WEATHER_MODELS } from "../../lib/weather/models";
import styles from "./Cockpit.module.css";

const FORECAST = [
  { time: "21 h", temperature: "16°C", wind: "12 km/h", Icon: Sun },
  { time: "22 h", temperature: "15°C", wind: "11 km/h", Icon: CloudSun },
  { time: "23 h", temperature: "14°C", wind: "10 km/h", Icon: Cloud },
  { time: "00 h", temperature: "13°C", wind: "9 km/h", Icon: Cloud },
] as const;

type ConditionsCardProps = {
  href: string;
  sunrise: string;
  sunset: string;
};

export default function ConditionsCard({ href, sunrise, sunset }: ConditionsCardProps) {
  const preferences = useWeatherPreferences();
  const [locationName, setLocationName] = useState<string | null>(null);
  useEffect(() => { setLocationName(loadFavoriteLaunchSites().find(({ id }) => id === preferences.favoriteWeatherLocationId)?.name ?? null); }, [preferences.favoriteWeatherLocationId]);
  const modelName = SUPPORTED_WEATHER_MODELS.find(({ providerModelId }) => providerModelId === preferences.weatherModel)?.label;
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
          <strong>{locationName ?? "Aucun lieu sélectionné"}{modelName ? ` · ${modelName}` : ""}</strong>
        </div>
        <div className={styles.hourlyForecast} aria-label="Prévision météo heure par heure">
          {FORECAST.map(({ time, temperature, wind, Icon }) => (
            <div key={time}>
              <strong>{time}</strong>
              <Icon size={16} aria-hidden="true" />
              <span>{temperature}</span>
              <small>{wind}</small>
            </div>
          ))}
        </div>
        <span className={styles.cardAction}>Voir le détail météo →</span>
      </Card>
    </Link>
  );
}
