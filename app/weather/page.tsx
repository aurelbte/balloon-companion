"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Droplets, Eye, Moon, Navigation, Snowflake, Star, Sun, Sunrise } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadFavoriteLaunchSites, type FavoriteLaunchSite } from "../lib/favoriteLaunchSites";
import { useWeatherPreferences } from "../contexts/WeatherPreferencesContext";
import { loadHourlyWeatherForecast } from "../lib/weather/hourlyForecastService";
import { SUPPORTED_WEATHER_MODELS } from "../lib/weather/models";
import { availableDays, availableTimes, closestAvailableDay, closestAvailableTime, dayKey, relativeUpdateLabel, timeKey } from "../lib/weather/weatherSelection";
import type { NormalizedWeatherCode, OpenMeteoWeatherModel, WeatherHourlyPoint } from "../lib/weather/openMeteo/types";
import type { MetarReading, TafReading, WeatherPageData, WeatherPlace } from "./types";
import styles from "./weather.module.css";

const EMPTY_DATA: WeatherPageData = { weatherPlace: null, aviationStation: null, sunTimes: null, forecast: [], metar: null, taf: null };
const ICONS = { CLEAR: Sun, PARTLY_CLOUDY: CloudSun, CLOUDY: Cloud, OVERCAST: Cloud, FOG: CloudFog, RAIN: CloudRain, HEAVY_RAIN: CloudRain, THUNDERSTORM: CloudLightning, SNOW: Snowflake, UNKNOWN: Cloud } satisfies Record<NormalizedWeatherCode, typeof Sun>;
const WEATHER_LABELS: Record<NormalizedWeatherCode, string> = { CLEAR: "Ciel dégagé", PARTLY_CLOUDY: "Peu nuageux", CLOUDY: "Nuageux", OVERCAST: "Couvert", FOG: "Brouillard", RAIN: "Pluie", HEAVY_RAIN: "Fortes pluies", THUNDERSTORM: "Orage", SNOW: "Neige", UNKNOWN: "Conditions inconnues" };

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
  const Icon = ICONS[slot.weatherCode];
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
  const [points, setPoints] = useState<readonly WeatherHourlyPoint[]>([]);
  const [favorites, setFavorites] = useState<FavoriteLaunchSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string>();
  const [selectedTime, setSelectedTime] = useState<string>();

  useEffect(() => {
    setFavorites(loadFavoriteLaunchSites());
  }, []);

  const activeFavorite = favorites.find(({ id }) => id === preferences.favoriteWeatherLocationId) ?? null;
  const coordinates = useMemo(() => activeFavorite ? { latitude: activeFavorite.latitude, longitude: activeFavorite.longitude } : null, [activeFavorite]);
  const model = preferences.weatherModel ?? "";

  useEffect(() => {
    if (!coordinates || !model) { setPoints([]); setLoading(false); setWeatherError(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setWeatherError(false);
    loadHourlyWeatherForecast({ ...coordinates, weatherModel: model as OpenMeteoWeatherModel }, controller.signal).then((forecast) => { setPoints(forecast.points); setLoading(false); }).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) { setPoints([]); setLoading(false); setWeatherError(true); } });
    return () => controller.abort();
  }, [coordinates, model, retryKey]);

  const days = useMemo(() => availableDays(points), [points]);
  const times = useMemo(() => selectedDay ? availableTimes(points, selectedDay) : [], [points, selectedDay]);
  useEffect(() => {
    const today = new Date();
    const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const localTime = `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;
    const nextDay = selectedDay && days.includes(selectedDay) ? selectedDay : closestAvailableDay(days, localDay);
    const nextTimes = nextDay ? availableTimes(points, nextDay) : [];
    setSelectedDay(nextDay);
    setSelectedTime((current) => closestAvailableTime(nextTimes, current ?? localTime));
  }, [days, points, selectedDay]);
  const dayIndex = selectedDay ? days.indexOf(selectedDay) : -1;
  const timeIndex = selectedTime ? times.indexOf(selectedTime) : -1;
  const selectedSlot = points.find((point) => dayKey(point.timestamp) === selectedDay && timeKey(point.timestamp) === selectedTime) ?? null;
  const modelName = SUPPORTED_WEATHER_MODELS.find(({ providerModelId }) => providerModelId === model)?.label ?? model;
  const dayLabel = selectedDay ? new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${selectedDay}T12:00:00`)) : "Jour";
  const changeDay = (offset: number) => { const day = days[dayIndex + offset]; if (!day) return; setSelectedDay(day); setSelectedTime((current) => closestAvailableTime(availableTimes(points, day), current)); };
  const changeTime = (offset: number) => {
    const time = times[timeIndex + offset];
    if (time) { setSelectedTime(time); return; }
    const adjacentDay = days[dayIndex + offset];
    if (!adjacentDay) return;
    const adjacentTimes = availableTimes(points, adjacentDay);
    const adjacentTime = offset > 0 ? adjacentTimes[0] : adjacentTimes.at(-1);
    if (!adjacentTime) return;
    setSelectedDay(adjacentDay);
    setSelectedTime(adjacentTime);
  };
  const choosePlace = (favorite: FavoriteLaunchSite) => preferences.setFavoriteWeatherLocationId(favorite.id);

  const previousTimeDisabled = timeIndex <= 0 && dayIndex <= 0;
  const nextTimeDisabled = timeIndex < 0 || (timeIndex >= times.length - 1 && dayIndex >= days.length - 1);
  return <main className={styles.screen}><header><Link href="/" aria-label="Retour au cockpit"><ArrowLeft /></Link><h1>Météo</h1></header><div className={styles.tabs} role="tablist"><button role="tab" aria-selected={tab === "weather"} onClick={() => setTab("weather")}>Météo</button><button role="tab" aria-selected={tab === "aviation"} onClick={() => setTab("aviation")}>Aviation</button></div>{tab === "weather" ? <div className={styles.content}><section className={`${styles.card} ${styles.preferenceGroup}`}><div className={styles.preferenceHeading}><span className={styles.eyebrow}>Lieu météo</span><button type="button" aria-label="Gérer les lieux favoris">+</button></div><div className={styles.chips}>{favorites.length === 0 ? <span className={styles.empty}>Aucun lieu météo sélectionné</span> : favorites.map((favorite) => <button type="button" key={favorite.id} aria-pressed={favorite.id === preferences.favoriteWeatherLocationId} onClick={() => choosePlace(favorite)}>{favorite.name}</button>)}</div></section><section className={`${styles.card} ${styles.preferenceGroup}`}><span className={styles.eyebrow}>Modèle météo</span><div className={styles.chips}>{SUPPORTED_WEATHER_MODELS.map((item) => <button type="button" key={item.id} aria-pressed={item.providerModelId === model} onClick={() => preferences.setWeatherModel(item.providerModelId)}>{item.label}</button>)}</div><div className={styles.sunBlock}>{data.sunTimes ? <><span><Sunrise size={16} />Lever — {data.sunTimes.sunrise}</span><span><Moon size={15} />Coucher — {data.sunTimes.sunset}</span></> : <span>Lever et coucher indisponibles</span>}</div></section><section className={styles.forecast}><div className={styles.temporalNav}><Stepper label="Jour" value={dayLabel} onPrevious={() => changeDay(-1)} onNext={() => changeDay(1)} previousDisabled={dayIndex <= 0} nextDisabled={dayIndex < 0 || dayIndex >= days.length - 1} /><Stepper label="Heure" value={selectedTime ?? "Heure"} onPrevious={() => changeTime(-1)} onNext={() => changeTime(1)} previousDisabled={previousTimeDisabled} nextDisabled={nextTimeDisabled} /></div><SelectedWeatherCard slot={selectedSlot} modelName={modelName} loading={loading} error={weatherError} onRetry={() => setRetryKey((value) => value + 1)} /></section></div> : <div className={styles.content}><PlaceCard title="Aérodrome" place={data.aviationStation} aviation /><ReportCard title="METAR" report={data.metar} /><ReportCard title="TAF" report={data.taf} /></div>}</main>;
}
