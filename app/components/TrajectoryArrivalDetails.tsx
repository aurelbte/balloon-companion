"use client";
import FlightDossierOperationsSummary from "./FlightDossierOperationsSummary";
import FlightDossierWeatherSummary from "./FlightDossierWeatherSummary";
import { loadFlightDossierWeather } from "../lib/flightDossierWeatherClient";
import type { FlightDossierWeather } from "../lib/flightDossierWeather";
import type { FlightDossierResult } from "../lib/flightDossierEntry";
import { balloonDisplayName } from "../lib/balloons";
import { useWeatherFreshness } from "../hooks/useWeatherFreshness";
import { HOURLY_POLICY, freshnessLabel, retrievalLabel } from "../lib/weather/weatherFreshness";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { airspaceVerticalNotice, normalizeOpenAipAltitudeLimit } from "../lib/airspaceAltitude";
import type { AirspaceFeatureCollection } from "../lib/openaip";
import { selectTrajectoryAirspaces } from "../lib/trajectoryAirspaces";
import { summarizeLandingWeather, trajectoryDistanceKm, trajectoryMaximumWindKmh, type LandingWeatherSummary } from "../lib/trajectoryArrivalSummary";
import { useUnitPreferences } from "../contexts/UnitPreferencesContext";
import { formatFlightDistance, formatWeatherWind } from "../lib/unitPreferences";
import type { WeatherAnalysisTrace } from "../lib/trajectory/weatherAnalysisStorage";
import type { WeatherHourlyForecast } from "../lib/weather/openMeteo/types";
import styles from "./TrajectoryArrivalDetails.module.css";
import { formatInTimeZone } from "../lib/timeZone.ts";

const time = (iso: string, timeZone?: string) => formatInTimeZone(iso, timeZone, { hour: "2-digit", minute: "2-digit" });
const duration = (seconds: number) => `${Math.round(seconds / 60)} min`;

export default function TrajectoryArrivalDetails({ trace, airspaces, timeZone, onClose, onFlightDossier }: { trace: WeatherAnalysisTrace; airspaces: AirspaceFeatureCollection; timeZone?: string; onClose(): void; onFlightDossier?: (traceId: string) => FlightDossierResult }) {
  const [dossier, setDossier] = useState<FlightDossierResult | null>(null);
  const [dossierWeather, setDossierWeather] = useState<FlightDossierWeather | null>(null);
  const [dossierWeatherError, setDossierWeatherError] = useState<string | null>(null);
  const [dossierDownload, setDossierDownload] = useState<string | null>(null);
  const [dossierPending, setDossierPending] = useState(false);
  const dossierRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setDossierDownload(null);
    setDossier(null);
    setDossierWeather(null);
    setDossierWeatherError(null);
    setDossierPending(false);
    return () => { dossierRequest.current?.abort(); };
  }, [trace]);
  const requestDossier = async () => {
    if (!onFlightDossier || dossierRequest.current && !dossierRequest.current.signal.aborted) return;
    const controller = new AbortController();
    dossierRequest.current = controller;
    setDossierPending(true);
    setDossierDownload(null);
    setDossierWeather(null);
    setDossierWeatherError(null);
    try {
      const prepared = onFlightDossier(trace.traceId);
      setDossier(prepared);
      if (prepared.status !== "READY") return;
      let weather: FlightDossierWeather | null = null;
      let weatherError: string | null = null;
      try {
        weather = await loadFlightDossierWeather(prepared.data, controller.signal);
        if (!controller.signal.aborted) setDossierWeather(weather);
      } catch (error) {
        controller.signal.throwIfAborted();
        weatherError = error instanceof Error ? error.message : "Météo du dossier indisponible.";
        setDossierWeatherError(`${weatherError} Ces données seront signalées comme indisponibles dans le PDF.`);
      }
      controller.signal.throwIfAborted();
      const { exportFlightDossier } = await import("../lib/flightDossierExport");
      const result = await exportFlightDossier({ dossier: prepared.data, weather, weatherError }, controller.signal);
      if (!controller.signal.aborted) setDossierDownload(result.mapUnavailable ? "Dossier téléchargé. Fond cartographique indisponible, signalé dans le PDF." : "Dossier de vol téléchargé.");
    } catch (error) {
      if (!controller.signal.aborted) setDossierWeatherError(`Génération du dossier impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`);
    } finally {
      if (dossierRequest.current === controller) dossierRequest.current = null;
      if (!controller.signal.aborted) setDossierPending(false);
    }
  };
  const [tab, setTab] = useState<"weather" | "airspaces">("weather");
  const units = useUnitPreferences();
  const [landing, setLanding] = useState<LandingWeatherSummary | null>(null);
  const landingFreshness = useWeatherFreshness(landing?.weatherFetchedAt, HOURLY_POLICY);
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
    <div className={styles.top}><div><strong>{trace.label} · {trace.model.label}</strong><span>{time(trace.projection.startedAt, timeZone)} → {time(end.timestamp, timeZone)} · {duration(trace.projection.durationSeconds)}</span></div><button type="button" onClick={onClose} aria-label="Fermer"><X size={18} /></button></div>
    {onFlightDossier && <section className={styles.content} aria-label="Dossier de vol PDF">
      <button type="button" disabled={dossierPending} onClick={requestDossier}>Dossier de vol PDF</button>
      {dossier && (dossier.status === "INVALID" ? <p role="alert">{dossier.message}</p> : <div role="status">
        <p>Données de la stratégie sélectionnée.</p>
        <p>{dossier.data.model.label} · {dossier.data.points.length} points · {time(dossier.data.startedAt, timeZone)} → {time(dossier.data.landingAt, timeZone)} · {duration(dossier.data.durationSeconds)}</p>
        <p>{balloonDisplayName(dossier.data.balloon)}</p>
      </div>)}
      {dossier?.status === "READY" && dossier.data.operations && <FlightDossierOperationsSummary data={dossier.data.operations} />}
      {dossierPending && <p role="status">Préparation et téléchargement du dossier PDF…</p>}
      {dossierDownload && <p role="status">{dossierDownload}</p>}
      {dossierWeatherError && <p role="alert">{dossierWeatherError}</p>}
      {dossierWeather && <FlightDossierWeatherSummary data={dossierWeather} />}
    </section>}
    <div className={styles.tabs}><button type="button" aria-pressed={tab === "weather"} onClick={() => setTab("weather")}>Météo vol</button><button type="button" aria-pressed={tab === "airspaces"} onClick={() => setTab("airspaces")}>Espaces aériens</button></div>
    {tab === "weather" ? <div className={styles.content}>
      <dl className={styles.metrics}><div><dt>Distance prévue</dt><dd>{formatFlightDistance(trajectoryDistanceKm(trace), units.flightInstruments.distanceUnit)}</dd></div><div><dt>Vent max</dt><dd>{speed(trajectoryMaximumWindKmh(trace))}</dd></div></dl>
      <section className={styles.landing}><h3>Atterrissage · rayon 3 km</h3>{landing && <p role="status">Prévision autour de l’arrivée du {formatInTimeZone(landing.forecastAtIso ?? end.timestamp, timeZone, { dateStyle: "short", timeStyle: "short" })} · {freshnessLabel(landingFreshness)} · {retrievalLabel(landing.weatherFetchedAt)} · Run du modèle inconnu</p>}{landingPending ? <p>Analyse…</p> : <dl className={styles.metrics}><div><dt>Vent moyen</dt><dd>{speed(landing?.averageWindKmh ?? null)}</dd></div><div><dt>Vent max</dt><dd>{speed(landing?.maximumWindKmh ?? null)}</dd></div><div><dt>Rafale max</dt><dd>{speed(landing?.maximumGustKmh ?? null)}</dd></div><div><dt>Direction</dt><dd>{landing?.directionLabel ?? "—"}</dd></div></dl>}</section>
    </div> : <div className={styles.content}>{crossedAirspaces.length === 0 ? <p>Aucun espace aérien identifié sur cette trajectoire.</p> : crossedAirspaces.map((airspace) => <section className={styles.airspace} key={airspace.airspaceCompositeKey || airspace.airspaceId}><h3>{airspace.name}</h3><p>{airspace.typeLabel} · Classe {airspace.icaoClassLabel}</p><strong>{normalizeOpenAipAltitudeLimit(airspace.lowerLimit).displayLabel} → {normalizeOpenAipAltitudeLimit(airspace.upperLimit).displayLabel}</strong><p>{airspaceVerticalNotice(airspace.lowerLimit, airspace.upperLimit)}</p>{airspace.frequencies.filter(({ value }) => value.trim()).map((frequency) => <span key={`${frequency.value}-${frequency.name ?? ""}`}>{frequency.name ? `${frequency.name} · ` : "Fréquence · "}{frequency.value}</span>)}</section>)}</div>}
  </aside>;
}
