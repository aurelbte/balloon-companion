"use client";
import MoroccoPassengerDialog from "./MoroccoPassengerDialog";
import type { MoroccoPassenger } from "../lib/moroccoPassengers";
import { resolveMoroccoDossierReference, type MoroccoDossierReference } from "../lib/moroccoDossierReference";
import { FileDown, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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
  const [passengerDossier, setPassengerDossier] = useState<Extract<FlightDossierResult, { status: "READY" }> | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuId = useId();
  const exportMenuRoot = useRef<HTMLDivElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const firstExportChoice = useRef<HTMLButtonElement>(null);
  const [dossier, setDossier] = useState<FlightDossierResult | null>(null);
  const [dossierWeather, setDossierWeather] = useState<FlightDossierWeather | null>(null);
  const [dossierWeatherError, setDossierWeatherError] = useState<string | null>(null);
  const [dossierDownload, setDossierDownload] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [dossierPending, setDossierPending] = useState(false);
  const dossierRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setFeedbackOpen(false);
    setPassengerDossier(null);
    setDossierDownload(null);
    setDossier(null);
    setDossierWeather(null);
    setDossierWeatherError(null);
    setDossierPending(false);
    return () => { dossierRequest.current?.abort(); };
  }, [trace]);
  useEffect(() => {
    if (!exportMenuOpen) return;
    firstExportChoice.current?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !exportMenuRoot.current?.contains(event.target)) setExportMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExportMenuOpen(false);
        exportButton.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [exportMenuOpen]);
  const requestDossier = async (variant: "FRANCE" | "MOROCCO" = "FRANCE", passengers?: readonly MoroccoPassenger[], alreadyPrepared?: FlightDossierResult, dossierReference?: MoroccoDossierReference) => {
    if (!onFlightDossier || dossierRequest.current && !dossierRequest.current.signal.aborted) return;
    const controller = new AbortController();
    dossierRequest.current = controller;
    setFeedbackOpen(true);
    setDossierPending(true);
    setDossierDownload(null);
    setDossierWeather(null);
    setDossierWeatherError(null);
    try {
      const prepared = alreadyPrepared ?? onFlightDossier(trace.traceId);
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
      const input = { dossier: prepared.data, weather, weatherError };
      const result = variant === "MOROCCO"
        ? await (await import("../lib/moroccoFlightDossierExport")).exportMoroccoFlightDossier({ ...input, passengers, dossierReference }, controller.signal)
        : await (await import("../lib/flightDossierExport")).exportFlightDossier(input, controller.signal);
      if (!controller.signal.aborted) setDossierDownload(result.mapUnavailable ? "Dossier téléchargé. Fond cartographique indisponible, signalé dans le PDF." : "Dossier de vol téléchargé.");
    } catch (error) {
      if (!controller.signal.aborted) setDossierWeatherError(`Génération du dossier impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`);
    } finally {
      if (dossierRequest.current === controller) dossierRequest.current = null;
      if (!controller.signal.aborted) setDossierPending(false);
    }
  };
  const openPassengerListing = () => {
    setExportMenuOpen(false);
    try {
      const prepared = onFlightDossier(trace.traceId);
      if (prepared.status === "READY") { resolveMoroccoDossierReference(prepared.data); setFeedbackOpen(false); setPassengerDossier(prepared); }
      else { setDossier(prepared); setFeedbackOpen(true); }
    } catch (error) {
      setDossierWeatherError(`Préparation du listing impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`);
      setFeedbackOpen(true);
    }
  };
  return (
    <div className="pointer-events-auto relative shrink-0">
      <div ref={exportMenuRoot}>
        <button ref={exportButton} type="button" aria-label="Dossier de vol PDF" aria-expanded={exportMenuOpen} aria-controls={exportMenuId} title="Exporter le dossier PDF" aria-busy={dossierPending} disabled={dossierPending} onClick={() => { setFeedbackOpen(false); setExportMenuOpen((open) => !open); }} className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-full border border-white/20 bg-[var(--bc-color-surface-glass)] text-white shadow-[var(--bc-shadow-high)] backdrop-blur-md disabled:opacity-50">{dossierPending ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <FileDown size={18} aria-hidden="true" />}<span className="text-[10px] font-semibold">PDF</span></button>
        {exportMenuOpen && <div id={exportMenuId} role="group" aria-label="Pays du dossier PDF" className="absolute bottom-full right-0 z-50 mb-2 w-40 max-w-[calc(100vw-24px)] rounded-xl border border-white/20 bg-slate-950 p-1 text-sm text-white shadow-xl">
          <button ref={firstExportChoice} type="button" onClick={() => { setExportMenuOpen(false); void requestDossier("FRANCE"); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><span aria-hidden="true">🇫🇷</span> France</button>
          <button type="button" onClick={openPassengerListing} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"><span aria-hidden="true">🇲🇦</span> Maroc</button>
        </div>}
      </div>
      {passengerDossier && <MoroccoPassengerDialog
        reference={resolveMoroccoDossierReference(passengerDossier.data)}
        onCancel={() => setPassengerDossier(null)}
        onExport={(passengers, reference) => { const prepared = passengerDossier; setPassengerDossier(null); void requestDossier("MOROCCO", passengers, prepared, reference); }}
      />}
      {feedbackOpen && <div className="absolute bottom-full right-0 z-50 mb-2 max-h-[40dvh] w-[min(280px,calc(100vw-88px))] overflow-y-auto rounded-xl border border-white/20 bg-slate-950 p-3 text-xs text-white shadow-xl">
      <div className="flex items-center justify-between gap-2"><p>{trace.model.label} · {trace.label}</p><button type="button" aria-label="Fermer le suivi du dossier PDF" className="min-h-11 min-w-11" onClick={() => setFeedbackOpen(false)}><X size={16} /></button></div>
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
      </div>}
    </div>
  );
}
