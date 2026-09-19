"use client";

import { Moon, Navigation, Star, Sunrise } from "lucide-react";
import Link from "next/link";
import { Card } from "../../design-system";
import { useWeatherPreferences } from "../../contexts/WeatherPreferencesContext";
import { useUnitPreferences } from "../../contexts/UnitPreferencesContext";
import { formatWeatherTemperature } from "../../lib/unitPreferences";
import { WeatherIcon } from "../../weather/presentation";
import { windArrowRotationDegrees } from "../../weather/windArrow";
import styles from "./Cockpit.module.css";
import { cockpitWeatherFreshnessLabel, cockpitWindDirection, cockpitWindSpeed } from "./weatherCardPresentation";
import { formatInTimeZone } from "../../lib/timeZone.ts";

export default function ConditionsCard({ href }: { href: string }) {
  const preferences = useWeatherPreferences();
  const units = useUnitPreferences();
  const point = preferences.currentWeather.point;
  return (
    <Link className={styles.cardLink} href={href} aria-label="Ouvrir la météo">
      <Card className={`${styles.card} ${styles.weatherCard}`}>
        <div className={styles.weatherHeader}>
          <h2 className={styles.cardTitle}>Météo</h2>
          <div className={styles.sunTimes} aria-label="Lever et coucher du soleil">
            <span><Sunrise size={11} aria-hidden="true" />{preferences.currentSunTimes?.sunrise ?? "—"}</span>
            <span><Moon size={10} aria-hidden="true" />{preferences.currentSunTimes?.sunset ?? "—"}</span>
          </div>
        </div>
        <div className={styles.weatherLocation}>
          {point && <WeatherIcon code={point.weatherCode} size={22} />}
          <div><span>Lieu favori <Star size={11} fill="currentColor" aria-hidden="true" /></span><strong>{preferences.activeFavorite?.name ?? "Aucun lieu sélectionné"}</strong><small>{preferences.modelName || "Aucun modèle"}</small></div>
        </div>
        <p className={styles.weatherForecastTime}>{preferences.currentWeather.validAt ? `Prévision pour le ${formatInTimeZone(preferences.currentWeather.validAt, preferences.forecastTimeZone, { dateStyle: "short", timeStyle: "short" })}` : "Prévision actuelle indisponible"}</p>
        <div className={styles.cockpitWeatherMetrics}>
          <div className={styles.cockpitWind}><Navigation size={18} aria-hidden="true" style={{ transform: `rotate(${windArrowRotationDegrees(point?.windDirectionDeg)}deg)` }} /><strong>{cockpitWindDirection(point?.windDirectionDeg)}</strong><b>{cockpitWindSpeed(point?.windSpeedKmh, units.weather.windSpeedUnit)}</b></div>
          <div><span>Rafales</span><strong>{cockpitWindSpeed(point?.windGustKmh, units.weather.windSpeedUnit)}</strong></div>
          <div><span>Température</span><strong>{point?.temperatureC === undefined ? "—" : formatWeatherTemperature(point.temperatureC, units.weather.temperatureUnit)}</strong></div>
        </div>
        <div className={styles.weatherFooter}><span className={styles.cardAction}>Voir le détail météo →</span><small role="status">{cockpitWeatherFreshnessLabel(preferences.freshness, { loading: preferences.loading, error: Boolean(preferences.error) })}</small></div>
      </Card>
    </Link>
  );
}
