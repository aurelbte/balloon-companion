"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Cloud, CloudRain, Droplets, Eye, Moon, Navigation, Star, Sunrise } from "lucide-react";
import { useState } from "react";
import { useWeatherPreferences } from "../contexts/WeatherPreferencesContext";
import { SUPPORTED_WEATHER_MODELS } from "../lib/weather/models";
import { relativeUpdateLabel } from "../lib/weather/weatherSelection";
import type { WeatherHourlyPoint } from "../lib/weather/openMeteo/types";
import type { MetarReading, TafReading, WeatherPageData, WeatherPlace } from "./types";
import { WEATHER_ICONS, WEATHER_LABELS } from "./presentation";
import styles from "./weather.module.css";

const EMPTY_DATA: WeatherPageData = { weatherPlace: null, aviationStation: null, sunTimes: null, forecast: [], metar: null, taf: null };

function PlaceCard({ title, place, aviation = false, onSelect }: { title: string; place: WeatherPlace | null; aviation?: boolean; onSelect?: () => void }) {
  return <section className={`${styles.card} ${styles.placeCard}`} onClick={onSelect}><div><span className={styles.eyebrow}>{title}</span>{place ? <><strong><Star size={14} fill="currentColor" />{place.name}</strong>{place.detail && <small>{place.detail}</small>}</> : <strong>{aviation ? "Aucun aérodrome sélectionné" : "Aucun lieu météo sélectionné"}</strong>}</div><button type="button" onClick={onSelect}>{place ? "Modifier" : aviation ? "Choisir un aérodrome" : "Choisir un lieu"}</button></section>;
}

function Stepper({ label, value, onPrevious, onNext, previousDisabled, nextDisabled }: { label: string; value: string; onPrevious: () => void; onNext: () => void; previousDisabled: boolean; nextDisabled: boolean }) {
  return <div className={styles.stepper} aria-label={label}><button type="button" onClick={onPrevious} disabled={previousDisabled} aria-label={`${label} précédent`}><ChevronLeft size={18} /></button><strong>{value}</strong><button type="button" onClick={onNext} disabled={nextDisabled} aria-label={`${label} suivant`}><ChevronRight size={18} /></button></div>;
}

const valueOrDash = (value: number | undefined, suffix = "") => value === undefined ? "—" : `${value}${suffix}`;
const visibilityLabel = (value: number | undefined) => value === undefined ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value / 1000)} km`;
function SelectedWeatherCard({ slot, modelName, loading, error, onRetry }: { slot: WeatherHourlyPoint | null; modelName: string; loading: boolean; error: boolean; onRetry: () => void }) {
  if (loading) return <section className={`${styles.card} ${styles.weatherDetail}`}><p className={styles.empty}>Chargement des prévisions…</p></section>;
  if (error) return <section className={`${styles.card} ${styles.weatherDetail}`}><div className={styles.weatherError}><p>Prévisions indisponibles</p><button type="button" onClick={onRetry}>Réessayer</button></div></section>;
  if (!slot) return <section className={`${styles.card} ${styles.weatherDetail}`}><p className={styles.empty}>Prévision indisponible pour ce créneau</p></section>;
  const Icon = WEATHER_ICONS[slot.weatherCode];
  const secondary = [{ label: "Humidité", value: valueOrDash(slot.humidityPercent, "%"), Icon: Droplets }, { label: "Précipitations", value: valueOrDash(slot.precipitationMm, " mm"), Icon: CloudRain }, { label: "Couverture", value: valueOrDash(slot.cloudCoverPercent, "%"), Icon: Cloud }, { label: "Visibilité", value: visibilityLabel(slot.visibilityM), Icon: Eye }];
  return <article className={`${styles.card} ${styles.weatherDetail}`}><div className={styles.weatherHero}><Icon size={54} /><strong>{valueOrDash(slot.temperatureC, "°C")}</strong><span>{WEATHER_LABELS[slot.weatherCode]}</span></div><div className={styles.windFocus}><div><Navigation size={21} /><strong>{valueOrDash(slot.windDirectionDeg, "°")}</strong><span>{valueOrDash(slot.windSpeedKmh, " km/h")}</span></div><p>Rafales <strong>{valueOrDash(slot.windGustKmh, " km/h")}</strong></p></div><dl className={styles.weatherSecondary}>{secondary.map(({ label, value, Icon: DetailIcon }) => <div key={label}><dt><DetailIcon size={15} />{label}</dt><dd>{value}</dd></div>)}</dl><footer><strong>{modelName}</strong><span>Actualisé {relativeUpdateLabel(slot.sourceUpdatedAt)}</span></footer></article>;
}

function ReportCard({ title, report }: { title: "METAR"; report: MetarReading | null } | { title: "TAF"; report: TafReading | null }) {
  if (!report) return <section className={styles.card}><h2>{title}</h2><p className={styles.empty}>{title === "TAF" ? "TAF non disponible pour cet aérodrome" : "METAR non disponible pour cet aérodrome"}</p></section>;
  if (title === "TAF") return <section className={styles.card}><h2>TAF</h2><h3>Lecture</h3>{report.periods.map((period) => <p key={period}>{period}</p>)}<h3>Brut</h3><pre>{report.raw || "—"}</pre></section>;
  const fields = [["Observation", report.observedAt], ["Vent", report.wind], ["Visibilité", report.visibility], ["Phénomènes", report.phenomena], ["Nébulosité / plafond", report.ceiling], ["Température", report.temperature], ["Point de rosée", report.dewPoint], ["QNH", report.qnh]];
  return <section className={styles.card}><h2>METAR</h2><h3>Lecture</h3><dl className={styles.reportGrid}>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl><h3>Brut</h3><pre>{report.raw || "—"}</pre></section>;
}

export default function WeatherPage() {
  const data = EMPTY_DATA;
  const preferences = useWeatherPreferences();
  const [tab, setTab] = useState<"weather" | "aviation">("weather");
  const model = preferences.weatherModel ?? "";
  const dayLabel = preferences.selectedDay ? new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${preferences.selectedDay}T12:00:00`)) : "Jour";
  const previousTimeDisabled = preferences.timeIndex <= 0 && preferences.dayIndex <= 0;
  const nextTimeDisabled = preferences.timeIndex < 0 || (preferences.timeIndex >= preferences.times.length - 1 && preferences.dayIndex >= preferences.days.length - 1);
  return <main className={styles.screen}><header><Link href="/" aria-label="Retour au cockpit"><ArrowLeft /></Link><h1>Météo</h1></header><div className={styles.tabs} role="tablist"><button role="tab" aria-selected={tab === "weather"} onClick={() => setTab("weather")}>Météo</button><button role="tab" aria-selected={tab === "aviation"} onClick={() => setTab("aviation")}>Aviation</button></div>{tab === "weather" ? <div className={styles.content}><section className={`${styles.card} ${styles.preferenceGroup}`}><div className={styles.preferenceHeading}><span className={styles.eyebrow}>Lieu météo</span><button type="button" aria-label="Gérer les lieux favoris">+</button></div><div className={styles.chips}>{preferences.favorites.length === 0 ? <span className={styles.empty}>Aucun lieu météo sélectionné</span> : preferences.favorites.map((favorite) => <button type="button" key={favorite.id} aria-pressed={favorite.id === preferences.favoriteWeatherLocationId} onClick={() => preferences.setFavoriteWeatherLocationId(favorite.id)}>{favorite.name}</button>)}</div></section><section className={`${styles.card} ${styles.preferenceGroup}`}><span className={styles.eyebrow}>Modèle météo</span><div className={styles.chips}>{SUPPORTED_WEATHER_MODELS.map((item) => <button type="button" key={item.id} aria-pressed={item.providerModelId === model} onClick={() => preferences.setWeatherModel(item.providerModelId)}>{item.label}</button>)}</div><div className={styles.sunBlock}>{data.sunTimes ? <><span><Sunrise size={16} />Lever — {data.sunTimes.sunrise}</span><span><Moon size={15} />Coucher — {data.sunTimes.sunset}</span></> : <span>Lever et coucher indisponibles</span>}</div></section><section className={styles.forecast}><div className={styles.temporalNav}><Stepper label="Jour" value={dayLabel} onPrevious={() => preferences.changeDay(-1)} onNext={() => preferences.changeDay(1)} previousDisabled={preferences.dayIndex <= 0} nextDisabled={preferences.dayIndex < 0 || preferences.dayIndex >= preferences.days.length - 1} /><Stepper label="Heure" value={preferences.selectedTime ?? "Heure"} onPrevious={() => preferences.changeTime(-1)} onNext={() => preferences.changeTime(1)} previousDisabled={previousTimeDisabled} nextDisabled={nextTimeDisabled} /></div><SelectedWeatherCard slot={preferences.selectedPoint} modelName={preferences.modelName} loading={preferences.loading} error={preferences.error} onRetry={preferences.retry} /></section></div> : <div className={styles.content}><PlaceCard title="Aérodrome" place={data.aviationStation} aviation /><ReportCard title="METAR" report={data.metar} /><ReportCard title="TAF" report={data.taf} /></div>}</main>;
}
