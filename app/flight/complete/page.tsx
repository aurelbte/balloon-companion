"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import {
  adjustOfficialDurationMinutes,
  defaultOfficialAscensionInput,
  type OfficialAscensionInput,
} from "../../lib/flightCompletion";
import { ensureDemoCompletionPersisted, persistJournalFlightDecision, persistOfficialAscension } from "../../lib/flightCompletionStorage";
import styles from "./FlightComplete.module.css";

type FlightRole = OfficialAscensionInput["pilotFunction"] | "NON_PILOT";

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

export default function FlightCompletePage() {
  const router = useRouter();
  const state = useFlightCompletionState();
  const [role, setRole] = useState<FlightRole | null>(null);
  const activeFlight = state.journalFlights.at(-1) ?? null;
  const [officialDuration, setOfficialDuration] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const demoEnabled = process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("demo") === "1";
      if (demoEnabled) ensureDemoCompletionPersisted();
      else if (!demoEnabled && state.journalFlights.length === 0) router.replace("/journal");
    }, 100);
    return () => window.clearTimeout(timer);
  }, [router, state.journalFlights.length]);

  const leaveForLater = () => {
    if (activeFlight) persistJournalFlightDecision(activeFlight.id, "CARNET_PENDING");
    window.sessionStorage.setItem("balloon-companion-journal-view", "flights");
    window.sessionStorage.setItem("balloon-companion-completion-deferred", activeFlight?.id ?? "");
    router.push("/journal");
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
      pilotFunction: role,
      maximumAltitudeM: activeFlight.maxAltitudeM,
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
    router.push("/journal");
  };

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <section className={styles.completionSheet} aria-labelledby="completion-title">
          <header><p className={styles.eyebrow}>Journal enregistré</p><h1 className={styles.title} id="completion-title">Vol enregistré</h1></header>
          <p className={styles.gpsDuration}><span>Durée GPS</span><strong>{formatDuration(activeFlight.durationMinutes)}</strong></p>
          <div className={styles.officialDuration}><span>Durée au carnet</span><div><button type="button" aria-label="Réduire la durée officielle de 1 minute" onClick={() => setOfficialDuration(adjustOfficialDurationMinutes(displayedOfficialDuration, -1))}><ChevronDown size={30} /></button><strong>{formatDuration(displayedOfficialDuration)}</strong><button type="button" aria-label="Augmenter la durée officielle de 1 minute" onClick={() => setOfficialDuration(adjustOfficialDurationMinutes(displayedOfficialDuration, 1))}><ChevronUp size={30} /></button></div></div>
          <fieldset className={styles.flightRole}><legend>Fonction pendant ce vol</legend>{(["Pilote", "Élève", "NON_PILOT"] as const).map((value) => <label key={value}><input type="radio" name="flight-role" checked={role === value} onChange={() => setRole(value)} /><span>{value === "NON_PILOT" ? "Je n’ai pas piloté" : value}</span></label>)}</fieldset>
          <div className={styles.completionActions}><button type="button" disabled={!role} onClick={confirm}>{role === "NON_PILOT" ? "Conserver uniquement dans le Journal" : "Ajouter au carnet"}</button><button type="button" onClick={leaveForLater}>Plus tard</button></div>
        </section>
      </div>
    </main>
  );
}
