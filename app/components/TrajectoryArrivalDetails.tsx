"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { normalizeOpenAipAltitudeLimit } from "../lib/airspaceAltitude";
import type { AirspaceFeatureCollection } from "../lib/openaip";
import { selectTrajectoryAirspaces } from "../lib/trajectoryAirspaces";
import { summarizeLandingWeather, trajectoryDistanceKm, trajectoryMaximumWindKmh, type LandingWeatherSummary } from "../lib/trajectoryArrivalSummary";
import { useUnitPreferences } from "../contexts/UnitPreferencesContext";
import { formatFlightDistance, formatWeatherWind } from "../lib/unitPreferences";
import type { WeatherAnalysisTrace } from "../lib/trajectory/weatherAnalysisStorage";
import type { WeatherHourlyForecast } from "../lib/weather/openMeteo/types";
import styles from "./TrajectoryArrivalDetails.module.css";

const time = (iso: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const duration = (seconds: number) => `${Math.round(seconds / 60)} min`;

export default function TrajectoryArrivalDetails({ trace, airspaces, onClose }: { trace: WeatherAnalysisTrace; airspaces: AirspaceFeatureCollection; onClose(): void }) {
  const [tab, setTab] = useState<"weather" | "airspaces">("weather");
  const units = useUnitPreferences();
  const [landing, setLanding] = useState<LandingWeatherSummary | null>(null);
  const [landingPending, setLandingPending] = useState(true);
  const end = trace.projection.points.at(-1)!;
  const crossedAirspaces = useMemo(() => selectTrajectoryAirspaces(trace, airspaces), [airspaces, trace]);
  const speed = (value: number | null) => value === null ? "—" : formatWeatherWind(value, units.weather.windSpeedUnit);

  useEffect(() => {
    const controller = new AbortController();
    setLanding(null);
    setLandingPending(true);
    fetch("/api/weather/landing-zone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: end.latitude, longitude: end.longitude, weatherModel: trace.model.providerModelId }),
      signal: controller.signal,
    }).then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { data?: WeatherHourlyForecast[] }) => setLanding(summarizeLandingWeather(payload.data ?? [], end.timestamp)))
      .catch(() => { if (!controller.signal.aborted) setLanding(null); })
      .finally(() => { if (!controller.signal.aborted) setLandingPending(false); });
    return () => controller.abort();
  }, [end.latitude, end.longitude, end.timestamp, trace.model.providerModelId]);

  return <aside className={styles.popup} aria-label="Détails de la trajectoire sélectionnée">
    <div className={styles.top}><div><strong>{trace.label} · {trace.model.label}</strong><span>{time(trace.projection.startedAt)} → {time(end.timestamp)} · {duration(trace.projection.durationSeconds)}</span></div><button type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button></div>
    <div className={styles.tabs}><button type="button" aria-pressed={tab === "weather"} onClick={() => setTab("weather")}>Météo vol</button><button type="button" aria-pressed={tab === "airspaces"} onClick={() => setTab("airspaces")}>Espaces aériens</button></div>
    {tab === "weather" ? <div className={styles.content}>
      <dl className={styles.metrics}><div><dt>Distance prévue</dt><dd>{formatFlightDistance(trajectoryDistanceKm(trace), units.flightInstruments.distanceUnit)}</dd></div><div><dt>Vent max</dt><dd>{speed(trajectoryMaximumWindKmh(trace))}</dd></div></dl>
      <section className={styles.landing}><h3>Atterrissage · rayon 3 km</h3>{landingPending ? <p>Analyse…</p> : <dl className={styles.metrics}><div><dt>Vent moyen</dt><dd>{speed(landing?.averageWindKmh ?? null)}</dd></div><div><dt>Vent max</dt><dd>{speed(landing?.maximumWindKmh ?? null)}</dd></div><div><dt>Rafale max</dt><dd>{speed(landing?.maximumGustKmh ?? null)}</dd></div><div><dt>Direction</dt><dd>{landing?.directionLabel ?? "—"}</dd></div></dl>}</section>
    </div> : <div className={styles.content}>{crossedAirspaces.length === 0 ? <p>Aucun espace aérien identifié sur cette trajectoire.</p> : crossedAirspaces.map((airspace) => <section className={styles.airspace} key={airspace.airspaceCompositeKey || airspace.airspaceId}><h3>{airspace.name}</h3><p>{airspace.typeLabel} · Classe {airspace.icaoClassLabel}</p><strong>{normalizeOpenAipAltitudeLimit(airspace.lowerLimit).displayLabel} → {normalizeOpenAipAltitudeLimit(airspace.upperLimit).displayLabel}</strong>{airspace.frequencies.filter(({ value }) => value.trim()).map((frequency) => <span key={`${frequency.value}-${frequency.name ?? ""}`}>{frequency.name ? `${frequency.name} · ` : "Fréquence · "}{frequency.value}</span>)}</section>)}</div>}
  </aside>;
}
