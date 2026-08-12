"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Moon, Snowflake, Star, Sun, Sunrise } from "lucide-react";
import { useMemo, useState } from "react";
import { SUPPORTED_WEATHER_MODELS } from "../lib/weather/models";
import type { MetarReading, TafReading, WeatherIconKind, WeatherPageData, WeatherPlace, WeatherSlot } from "./types";
import styles from "./weather.module.css";

const EMPTY_DATA: WeatherPageData = { weatherPlace: null, aviationStation: null, sunTimes: null, forecast: [], metar: null, taf: null };
const ICONS = { "clear-day": Sun, "clear-night": Moon, "partly-cloudy": CloudSun, cloudy: Cloud, overcast: Cloud, fog: CloudFog, rain: CloudRain, "heavy-rain": CloudRain, thunderstorm: CloudLightning, snow: Snowflake } satisfies Record<WeatherIconKind, typeof Sun>;

function PlaceCard({ title, place, aviation = false }: { title: string; place: WeatherPlace | null; aviation?: boolean }) {
  return <section className={`${styles.card} ${styles.placeCard}`}><div><span className={styles.eyebrow}>{title}</span>{place ? <><strong><Star size={14} fill="currentColor" />{place.name}</strong>{place.detail && <small>{place.detail}</small>}</> : <strong>{aviation ? "Aucun aérodrome sélectionné" : "Aucun lieu météo sélectionné"}</strong>}</div><button type="button">{place ? "Modifier" : aviation ? "Choisir un aérodrome" : "Choisir un lieu"}</button></section>;
}

function Stepper({ label, value, onPrevious, onNext, disabled }: { label: string; value: string; onPrevious: () => void; onNext: () => void; disabled: boolean }) {
  return <div className={styles.stepper} aria-label={label}><button type="button" onClick={onPrevious} disabled={disabled} aria-label={`${label} précédent`}><ChevronLeft size={18} /></button><strong>{value}</strong><button type="button" onClick={onNext} disabled={disabled} aria-label={`${label} suivant`}><ChevronRight size={18} /></button></div>;
}

function SelectedWeatherCard({ slot }: { slot: WeatherSlot | null }) {
  if (!slot) return <section className={`${styles.card} ${styles.weatherDetail}`}><p className={styles.empty}>Prévision indisponible pour ce créneau</p></section>;
  const Icon = ICONS[slot.icon];
  const details = [["Direction", slot.windDirection], ["Vent moyen", slot.windSpeed], ["Rafales", slot.gusts], ["Humidité", slot.humidity], ["Précipitations", slot.precipitation], ["Visibilité", slot.visibility], ["Couverture nuageuse", slot.cloudCover]];
  return <article className={`${styles.card} ${styles.weatherDetail}`}><div className={styles.weatherHero}><Icon size={58} /><strong>{slot.temperature}</strong></div><dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><footer><strong>{slot.modelName}</strong><span>Actualisé {slot.updatedAgo}</span></footer></article>;
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
  const [model, setModel] = useState(SUPPORTED_WEATHER_MODELS[0]?.providerModelId ?? "");
  const days = useMemo(() => [...new Map(data.forecast.map((slot) => [slot.dayId, slot.dayLabel])).entries()], [data.forecast]);
  const times = useMemo(() => [...new Set(data.forecast.map((slot) => slot.time))], [data.forecast]);
  const [dayIndex, setDayIndex] = useState(0);
  const [timeIndex, setTimeIndex] = useState(0);
  const selectedDay = days[dayIndex];
  const selectedTime = times[timeIndex];
  const selectedSlot = data.forecast.find((slot) => slot.dayId === selectedDay?.[0] && slot.time === selectedTime) ?? null;
  const stepDay = (offset: number) => setDayIndex((current) => (current + offset + days.length) % days.length);
  const stepTime = (offset: number) => setTimeIndex((current) => (current + offset + times.length) % times.length);
  return <main className={styles.screen}><header><Link href="/" aria-label="Retour au cockpit"><ArrowLeft /></Link><h1>Météo</h1></header><div className={styles.tabs} role="tablist"><button role="tab" aria-selected={tab === "weather"} onClick={() => setTab("weather")}>Météo</button><button role="tab" aria-selected={tab === "aviation"} onClick={() => setTab("aviation")}>Aviation</button></div>{tab === "weather" ? <div className={styles.content}><PlaceCard title="Lieu météo" place={data.weatherPlace} /><section className={`${styles.card} ${styles.settings}`}><label>Modèle météo<select value={model} onChange={(event) => setModel(event.target.value)}>{SUPPORTED_WEATHER_MODELS.map((item) => <option key={item.id} value={item.providerModelId}>{item.label}</option>)}</select></label><div className={styles.sunBlock}>{data.sunTimes ? <><span><Sunrise size={16} />Lever — {data.sunTimes.sunrise}</span><span><Moon size={15} />Coucher — {data.sunTimes.sunset}</span></> : <span>Lever et coucher indisponibles</span>}</div></section><section className={styles.forecast}><div className={styles.temporalNav}><Stepper label="Jour" value={selectedDay?.[1] ?? "Jour"} onPrevious={() => stepDay(-1)} onNext={() => stepDay(1)} disabled={days.length < 2} /><Stepper label="Heure" value={selectedTime ?? "Heure"} onPrevious={() => stepTime(-1)} onNext={() => stepTime(1)} disabled={times.length < 2} /></div><SelectedWeatherCard slot={selectedSlot} /></section></div> : <div className={styles.content}><PlaceCard title="Aérodrome" place={data.aviationStation} aviation /><ReportCard title="METAR" report={data.metar} /><ReportCard title="TAF" report={data.taf} /></div>}</main>;
}
