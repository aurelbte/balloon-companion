"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Moon, Snowflake, Star, Sun, Sunrise } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadPreparationDraft } from "../lib/preparationDraftStorage";
import { loadFavoriteLaunchSites, type FavoriteLaunchSite } from "../lib/favoriteLaunchSites";
import { loadHourlyWeatherForecast } from "../lib/weather/hourlyForecastService";
import { SUPPORTED_WEATHER_MODELS } from "../lib/weather/models";
import { availableDays, availableTimes, closestAvailableDay, closestAvailableTime, dayKey, relativeUpdateLabel, timeKey } from "../lib/weather/weatherSelection";
import type { NormalizedWeatherCode, OpenMeteoWeatherModel, WeatherHourlyPoint } from "../lib/weather/openMeteo/types";
import type { MetarReading, TafReading, WeatherPageData, WeatherPlace } from "./types";
import styles from "./weather.module.css";

const EMPTY_DATA: WeatherPageData = { weatherPlace: null, aviationStation: null, sunTimes: null, forecast: [], metar: null, taf: null };
const ICONS = { CLEAR: Sun, PARTLY_CLOUDY: CloudSun, CLOUDY: Cloud, OVERCAST: Cloud, FOG: CloudFog, RAIN: CloudRain, HEAVY_RAIN: CloudRain, THUNDERSTORM: CloudLightning, SNOW: Snowflake, UNKNOWN: Cloud } satisfies Record<NormalizedWeatherCode, typeof Sun>;

function PlaceCard({ title, place, aviation = false, onSelect }: { title: string; place: WeatherPlace | null; aviation?: boolean; onSelect?: () => void }) {
  return <section className={`${styles.card} ${styles.placeCard}`} onClick={onSelect}><div><span className={styles.eyebrow}>{title}</span>{place ? <><strong><Star size={14} fill="currentColor" />{place.name}</strong>{place.detail && <small>{place.detail}</small>}</> : <strong>{aviation ? "Aucun aérodrome sélectionné" : "Aucun lieu météo sélectionné"}</strong>}</div><button type="button" onClick={onSelect}>{place ? "Modifier" : aviation ? "Choisir un aérodrome" : "Choisir un lieu"}</button></section>;
}

function Stepper({ label, value, onPrevious, onNext, previousDisabled, nextDisabled }: { label: string; value: string; onPrevious: () => void; onNext: () => void; previousDisabled: boolean; nextDisabled: boolean }) {
  return <div className={styles.stepper} aria-label={label}><button type="button" onClick={onPrevious} disabled={previousDisabled} aria-label={`${label} précédent`}><ChevronLeft size={18} /></button><strong>{value}</strong><button type="button" onClick={onNext} disabled={nextDisabled} aria-label={`${label} suivant`}><ChevronRight size={18} /></button></div>;
}

const valueOrDash = (value: number | undefined, suffix = "") => value === undefined ? "—" : `${value}${suffix}`;
function SelectedWeatherCard({ slot, modelName, loading, error, onRetry }: { slot: WeatherHourlyPoint | null; modelName: string; loading: boolean; error: boolean; onRetry: () => void }) {
  if (loading) return <section className={`${styles.card} ${styles.weatherDetail}`}><p className={styles.empty}>Chargement des prévisions…</p></section>;
  if (error) return <section className={`${styles.card} ${styles.weatherDetail}`}><div className={styles.weatherError}><p>Prévisions indisponibles</p><button type="button" onClick={onRetry}>Réessayer</button></div></section>;
  if (!slot) return <section className={`${styles.card} ${styles.weatherDetail}`}><p className={styles.empty}>Prévision indisponible pour ce créneau</p></section>;
  const Icon = ICONS[slot.weatherCode];
  const details = [["Direction", valueOrDash(slot.windDirectionDeg, "°")], ["Vent moyen", valueOrDash(slot.windSpeedKmh, " km/h")], ["Rafales", valueOrDash(slot.windGustKmh, " km/h")], ["Humidité", valueOrDash(slot.humidityPercent, "%")], ["Précipitations", valueOrDash(slot.precipitationMm, " mm")], ["Visibilité", valueOrDash(slot.visibilityM, " m")], ["Couverture nuageuse", valueOrDash(slot.cloudCoverPercent, "%")]];
  return <article className={`${styles.card} ${styles.weatherDetail}`}><div className={styles.weatherHero}><Icon size={58} /><strong>{valueOrDash(slot.temperatureC, "°C")}</strong></div><dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><footer><strong>{modelName}</strong><span>Actualisé {relativeUpdateLabel(slot.sourceUpdatedAt)}</span></footer></article>;
}

function ReportCard({ title, report }: { title: "METAR"; report: MetarReading | null } | { title: "TAF"; report: TafReading | null }) {
  if (!report) return <section className={styles.card}><h2>{title}</h2><p className={styles.empty}>{title === "TAF" ? "TAF non disponible pour cet aérodrome" : "METAR non disponible pour cet aérodrome"}</p></section>;
  if (title === "TAF") return <section className={styles.card}><h2>TAF</h2><h3>Lecture</h3>{report.periods.map((period) => <p key={period}>{period}</p>)}<h3>Brut</h3><pre>{report.raw || "—"}</pre></section>;
  const fields = [["Observation", report.observedAt], ["Vent", report.wind], ["Visibilité", report.visibility], ["Phénomènes", report.phenomena], ["Nébulosité / plafond", report.ceiling], ["Température", report.temperature], ["Point de rosée", report.dewPoint], ["QNH", report.qnh]];
  return <section className={styles.card}><h2>METAR</h2><h3>Lecture</h3><dl className={styles.reportGrid}>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl><h3>Brut</h3><pre>{report.raw || "—"}</pre></section>;
}

export default function WeatherPage() {
  const data = EMPTY_DATA;
  const [tab, setTab] = useState<"weather" | "aviation">("weather");
  const [place, setPlace] = useState<WeatherPlace | null>(null);
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [model, setModel] = useState("");
  const [points, setPoints] = useState<readonly WeatherHourlyPoint[]>([]);
  const [favorites, setFavorites] = useState<FavoriteLaunchSite[]>([]);
  const [placePanelOpen, setPlacePanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string>();
  const [selectedTime, setSelectedTime] = useState<string>();

  useEffect(() => {
    setFavorites(loadFavoriteLaunchSites());
    const preparation = loadPreparationDraft();
    if (!preparation?.launchSite) return;
    setPlace({ name: preparation.launchSite.name });
    setCoordinates({ latitude: preparation.launchSite.latitude, longitude: preparation.launchSite.longitude });
    setModel(preparation.weatherModel);
  }, []);

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
  const changeTime = (offset: number) => { const time = times[timeIndex + offset]; if (time) setSelectedTime(time); };
  const choosePlace = (favorite: FavoriteLaunchSite) => { setPlace({ name: favorite.name, ...(favorite.icaoCode ? { detail: favorite.icaoCode } : {}) }); setCoordinates({ latitude: favorite.latitude, longitude: favorite.longitude }); setPlacePanelOpen(false); };

  return <main className={styles.screen}><header><Link href="/" aria-label="Retour au cockpit"><ArrowLeft /></Link><h1>Météo</h1></header><div className={styles.tabs} role="tablist"><button role="tab" aria-selected={tab === "weather"} onClick={() => setTab("weather")}>Météo</button><button role="tab" aria-selected={tab === "aviation"} onClick={() => setTab("aviation")}>Aviation</button></div>{tab === "weather" ? <div className={styles.content}><PlaceCard title="Lieu météo" place={place} onSelect={() => setPlacePanelOpen(true)} /><section className={`${styles.card} ${styles.settings}`}><label>Modèle météo<select value={model} disabled={!coordinates} onChange={(event) => setModel(event.target.value)}><option value="">—</option>{SUPPORTED_WEATHER_MODELS.map((item) => <option key={item.id} value={item.providerModelId}>{item.label}</option>)}</select></label><div className={styles.sunBlock}>{data.sunTimes ? <><span><Sunrise size={16} />Lever — {data.sunTimes.sunrise}</span><span><Moon size={15} />Coucher — {data.sunTimes.sunset}</span></> : <span>Lever et coucher indisponibles</span>}</div></section><section className={styles.forecast}><div className={styles.temporalNav}><Stepper label="Jour" value={dayLabel} onPrevious={() => changeDay(-1)} onNext={() => changeDay(1)} previousDisabled={dayIndex <= 0} nextDisabled={dayIndex < 0 || dayIndex >= days.length - 1} /><Stepper label="Heure" value={selectedTime ?? "Heure"} onPrevious={() => changeTime(-1)} onNext={() => changeTime(1)} previousDisabled={timeIndex <= 0} nextDisabled={timeIndex < 0 || timeIndex >= times.length - 1} /></div><SelectedWeatherCard slot={selectedSlot} modelName={modelName} loading={loading} error={weatherError} onRetry={() => setRetryKey((value) => value + 1)} /></section></div> : <div className={styles.content}><PlaceCard title="Aérodrome" place={data.aviationStation} aviation /><ReportCard title="METAR" report={data.metar} /><ReportCard title="TAF" report={data.taf} /></div>}{placePanelOpen && <div className={styles.modalBackdrop} role="presentation" onClick={() => setPlacePanelOpen(false)}><section className={styles.placePanel} role="dialog" aria-modal="true" aria-label="Choisir un lieu météo" onClick={(event) => event.stopPropagation()}><h2>Choisir un lieu météo</h2>{favorites.length === 0 ? <p className={styles.empty}>Aucun lieu favori enregistré</p> : favorites.map((favorite) => <button type="button" key={favorite.id} onClick={() => choosePlace(favorite)}><Star size={14} />{favorite.name}</button>)}<button type="button" onClick={() => setPlacePanelOpen(false)}>Fermer</button></section></div>}</main>;
}
