"use client";

import Link from "next/link";
import { ArrowLeft, Cloud, CloudFog, CloudLightning, CloudRain, CloudSun, Moon, Snowflake, Star, Sun, Sunrise } from "lucide-react";
import { useState } from "react";
import { SUPPORTED_WEATHER_MODELS } from "../lib/weather/models";
import type { HourlyWeather, MetarReading, TafReading, WeatherIconKind, WeatherPageData, WeatherPlace } from "./types";
import styles from "./weather.module.css";

const EMPTY_DATA: WeatherPageData = { weatherPlace: null, aviationStation: null, sunTimes: null, hourly: [], metar: null, taf: null };
const ICONS = { "clear-day": Sun, "clear-night": Moon, "partly-cloudy": CloudSun, cloudy: Cloud, overcast: Cloud, fog: CloudFog, rain: CloudRain, "heavy-rain": CloudRain, thunderstorm: CloudLightning, snow: Snowflake } satisfies Record<WeatherIconKind, typeof Sun>;

function PlaceCard({ title, place, aviation = false }: { title: string; place: WeatherPlace | null; aviation?: boolean }) {
  return <section className={`${styles.card} ${styles.placeCard}`}><div><span className={styles.eyebrow}>{title}</span>{place ? <><strong><Star size={14} fill="currentColor" />{place.name}</strong>{place.detail && <small>{place.detail}</small>}</> : <strong>{aviation ? "Aucun aérodrome sélectionné" : "Aucun lieu météo sélectionné"}</strong>}</div><button type="button">{place ? "Modifier" : aviation ? "Choisir un aérodrome" : "Choisir un lieu"}</button></section>;
}

function HourlySection({ hours }: { hours: readonly HourlyWeather[] }) {
  return <section><h2>Heure par heure</h2>{hours.length === 0 ? <div className={`${styles.card} ${styles.empty}`}>Prévisions horaires indisponibles</div> : <div className={styles.hourlyList}>{hours.map((hour) => { const Icon = ICONS[hour.icon]; return <article className={styles.hourCard} key={hour.id}><strong>{hour.time}</strong><Icon size={24} /><span>{hour.temperature}</span><div><b>{hour.windDirection}</b><span>Vent {hour.windSpeed}</span><small>Rafales {hour.gusts}</small></div></article>; })}</div>}</section>;
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
  return <main className={styles.screen}><header><Link href="/" aria-label="Retour au cockpit"><ArrowLeft /></Link><h1>Météo</h1></header><div className={styles.tabs} role="tablist"><button role="tab" aria-selected={tab === "weather"} onClick={() => setTab("weather")}>Météo</button><button role="tab" aria-selected={tab === "aviation"} onClick={() => setTab("aviation")}>Aviation</button></div>{tab === "weather" ? <div className={styles.content}><PlaceCard title="Lieu météo" place={data.weatherPlace} /><section className={`${styles.card} ${styles.settings}`}><label>Modèle météo<select value={model} onChange={(event) => setModel(event.target.value)}>{SUPPORTED_WEATHER_MODELS.map((item) => <option key={item.id} value={item.providerModelId}>{item.label}</option>)}</select></label><div className={styles.sunBlock}>{data.sunTimes ? <><span><Sunrise size={16} />Lever — {data.sunTimes.sunrise}</span><span><Moon size={15} />Coucher — {data.sunTimes.sunset}</span></> : <span>Lever et coucher indisponibles</span>}</div></section><HourlySection hours={data.hourly} /></div> : <div className={styles.content}><PlaceCard title="Aérodrome" place={data.aviationStation} aviation /><ReportCard title="METAR" report={data.metar} /><ReportCard title="TAF" report={data.taf} /></div>}</main>;
}
