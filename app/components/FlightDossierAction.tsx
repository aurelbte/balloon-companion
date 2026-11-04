"use client";
import { useEffect, useRef, useState } from "react";
import FlightDossierOperationsSummary from "./FlightDossierOperationsSummary";
import FlightDossierWeatherSummary from "./FlightDossierWeatherSummary";
import { loadFlightDossierWeather } from "../lib/flightDossierWeatherClient";
import type { FlightDossierWeather } from "../lib/flightDossierWeather";
import type { FlightDossierResult } from "../lib/flightDossierEntry";
import type { WeatherAnalysisTrace } from "../lib/trajectory/weatherAnalysisStorage";
import { balloonDisplayName } from "../lib/balloons";
import { formatInTimeZone } from "../lib/timeZone.ts";

const time = (iso: string, timeZone?: string) => formatInTimeZone(iso, timeZone, { hour: "2-digit", minute: "2-digit" });
const duration = (seconds: number) => `${Math.round(seconds / 60)} min`;

export default function FlightDossierAction({ trace, timeZone, onFlightDossier }: { trace: WeatherAnalysisTrace; timeZone?: string; onFlightDossier: (traceId: string) => FlightDossierResult }) {
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
  return (
    <section className="border-t border-white/15 px-2.5 py-2" aria-label="Dossier de vol PDF">
      <button type="button" disabled={dossierPending} onClick={requestDossier} className="flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--bc-accent)] px-3 text-xs font-bold text-[var(--bc-accent-foreground)] disabled:opacity-50">Dossier de vol PDF</button>
      <p className="mt-1 text-[10px]">{trace.model.label} · {trace.label}</p>
      <div className="max-h-[24dvh] overflow-y-auto text-xs">
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
      </div>
    </section>
  );
}
