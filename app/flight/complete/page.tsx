"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import {
  adjustOfficialDurationMinutes,
  defaultOfficialAscensionInput,
  DEMO_COMPLETION_FLIGHT_ID,
  roundJournalAltitudeMeters,
  pilotFunctionForRegulatoryRole,
  type CompletionJournalFlight,
  type OfficialAscensionInput,
  type OfficialRegulatoryRole,
} from "../../lib/flightCompletion";
import { ensureDemoCompletionPersisted, findJournalFlightBySourceId, persistJournalFlightDecision, persistOfficialAscension, reconcileRecordedFlightJournalProjection } from "../../lib/flightCompletionStorage";
import { DATA_SCOPE_CHANGED_EVENT } from "../../lib/auth/dataScopeRuntime";
import styles from "./FlightComplete.module.css";

type FlightRole = OfficialRegulatoryRole | "NON_PILOT";

const FLIGHT_ROLE_LABELS: Readonly<Record<FlightRole, string>> = Object.freeze({
  PIC: "Commandant de bord (PIC)",
  DUAL: "Double commande",
  FI_B: "Instructeur FI(B)",
  FE_B: "Examinateur FE(B)",
  NON_PILOT: "Je n’ai pas piloté",
});

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

function FlightCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const journalPath = () => `/journal${new URLSearchParams(window.location.search).get("cloudSyncTest") === "targeted" ? "?cloudSyncTest=targeted" : ""}`;
  const state = useFlightCompletionState();
  const [role, setRole] = useState<FlightRole | null>(null);
  const demoEnabled = process.env.NODE_ENV === "development" && searchParams.get("demo") === "1";
  const requestedFlightId = searchParams.get("flightId") ?? (demoEnabled ? DEMO_COMPLETION_FLIGHT_ID : null);
  const [resolvedFlight, setResolvedFlight] = useState<CompletionJournalFlight | null>(null);
  const activeFlight = requestedFlightId
    ? findJournalFlightBySourceId(state, requestedFlightId) ??
      ((resolvedFlight?.sourceFlightId ?? resolvedFlight?.id) === requestedFlightId ? resolvedFlight : null)
    : null;
  const [officialDuration, setOfficialDuration] = useState<number | null>(null);
  const [resolutionFinished, setResolutionFinished] = useState(false);
  const [scopeVersion, setScopeVersion] = useState(0);

  useEffect(() => {
    const retryForScope = () => setScopeVersion((version) => version + 1);
    window.addEventListener(DATA_SCOPE_CHANGED_EVENT, retryForScope);
    return () => window.removeEventListener(DATA_SCOPE_CHANGED_EVENT, retryForScope);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResolutionFinished(false);
    setResolvedFlight(null);
    const resolve = async () => {
      let flight: CompletionJournalFlight | null = null;
      if (demoEnabled) {
        flight = findJournalFlightBySourceId(ensureDemoCompletionPersisted(), DEMO_COMPLETION_FLIGHT_ID);
      }
      else if (requestedFlightId) {
        const result = await reconcileRecordedFlightJournalProjection(requestedFlightId);
        if (result.status === "SCOPE_UNAVAILABLE" || result.status === "SCOPE_CHANGED") return;
        flight = result.flight;
      }
      if (!cancelled) {
        setResolvedFlight(flight);
        setResolutionFinished(true);
      }
    };
    void resolve().catch(() => { if (!cancelled) setResolutionFinished(true); });
    return () => { cancelled = true; };
  }, [demoEnabled, requestedFlightId, scopeVersion]);

  useEffect(() => {
    if (resolutionFinished && !activeFlight) router.replace(journalPath());
  }, [activeFlight, resolutionFinished, router]);

  const leaveForLater = () => {
    if (activeFlight) persistJournalFlightDecision(activeFlight.id, "CARNET_PENDING");
    window.sessionStorage.setItem("balloon-companion-journal-view", "flights");
    window.sessionStorage.setItem("balloon-companion-completion-deferred", activeFlight?.id ?? "");
    router.push(journalPath());
  };

  const officialInput = useMemo(() => {
    if (!activeFlight || role === null || role === "NON_PILOT") return null;
    const duration = officialDuration ?? activeFlight.durationMinutes;
    const defaults = defaultOfficialAscensionInput();
    return {
      ...defaults,
      dateIso: activeFlight.dateIso,
      date: activeFlight.date,
      registration: activeFlight.balloonRegistration,
      departure: activeFlight.departure,
      arrival: activeFlight.arrival,
      pilotFunction: pilotFunctionForRegulatoryRole(role),
      regulatoryRole: role,
      supervisedByFiB: false,
      maximumAltitudeM: roundJournalAltitudeMeters(activeFlight.maxAltitudeM),
      officialDurationMinutes: duration,
    } satisfies OfficialAscensionInput;
  }, [activeFlight, officialDuration, role]);

  if (!activeFlight) return null;
  const displayedOfficialDuration = officialDuration ?? activeFlight.durationMinutes;

  const confirm = () => {
    if (role === "NON_PILOT") persistJournalFlightDecision(activeFlight.id, "JOURNAL_ONLY");
    else if (officialInput) persistOfficialAscension(activeFlight.id, officialInput);
    else return;
    window.sessionStorage.setItem("balloon-companion-journal-view", "flights");
    router.push(journalPath());
  };

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <section className={styles.completionSheet} aria-labelledby="completion-title">
          <header><p className={styles.eyebrow}>Journal enregistré</p><h1 className={styles.title} id="completion-title">Vol enregistré</h1></header>
          <p className={styles.gpsDuration}><span>Durée GPS</span><strong>{formatDuration(activeFlight.durationMinutes)}</strong></p>
          <div className={styles.officialDuration}><span>Durée au carnet</span><div><button type="button" aria-label="Réduire la durée officielle de 1 minute" onClick={() => setOfficialDuration(adjustOfficialDurationMinutes(displayedOfficialDuration, -1))}><ChevronDown size={30} /></button><strong>{formatDuration(displayedOfficialDuration)}</strong><button type="button" aria-label="Augmenter la durée officielle de 1 minute" onClick={() => setOfficialDuration(adjustOfficialDurationMinutes(displayedOfficialDuration, 1))}><ChevronUp size={30} /></button></div></div>
          <fieldset className={styles.flightRole}><legend>Fonction pendant ce vol</legend>{(["PIC", "DUAL", "FI_B", "FE_B", "NON_PILOT"] as const).map((value) => <label key={value}><input type="radio" name="flight-role" checked={role === value} onChange={() => setRole(value)} /><span>{FLIGHT_ROLE_LABELS[value]}</span></label>)}</fieldset>
          <div className={styles.completionActions}><button type="button" disabled={!role} onClick={confirm}>{role === "NON_PILOT" ? "Conserver uniquement dans le Journal" : "Ajouter au carnet"}</button><button type="button" onClick={leaveForLater}>Plus tard</button></div>
        </section>
      </div>
    </main>
  );
}

export default function FlightCompletePage() {
  return <Suspense fallback={null}><FlightCompleteContent /></Suspense>;
}
