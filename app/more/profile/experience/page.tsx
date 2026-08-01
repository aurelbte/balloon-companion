"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadFlightCompletionState, persistPilotExperience } from "../../../lib/flightCompletionStorage";
import styles from "../../More.module.css";

type Values = { hours: string; minutes: string; ascensions: string; confirmed: boolean };

export default function PilotExperiencePage() {
  const router = useRouter();
  const [values, setValues] = useState<Values | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const balance = loadFlightCompletionState().openingBalance;
      const total = balance.officialDurationMinutes;
      setValues({
        hours: balance.confirmed && total !== null ? String(Math.floor(total / 60)) : "",
        minutes: balance.confirmed && total !== null ? String(total % 60) : "",
        ascensions: balance.confirmed && balance.ascensions !== null ? String(balance.ascensions) : "",
        confirmed: balance.confirmed,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (!values) return null;
  const hours = values.hours === "" ? Number.NaN : Number(values.hours);
  const minutes = values.minutes === "" ? Number.NaN : Number(values.minutes);
  const ascensions = values.ascensions === "" ? Number.NaN : Number(values.ascensions);
  const valid = Number.isInteger(hours) && hours >= 0 && Number.isInteger(minutes) && minutes >= 0 && minutes <= 59 && Number.isInteger(ascensions) && ascensions >= 0;
  const setNumeric = (key: "hours" | "minutes" | "ascensions", value: string) => setValues((current) => current ? { ...current, [key]: value.replace(/\D/g, "") } : current);
  return <main className={styles.screen}><div className={styles.layout}>
    <button type="button" className={styles.back} onClick={() => router.push("/more/profile")}><ChevronLeft size={18} aria-hidden="true" /> Profil pilote</button>
    <header><p className={styles.eyebrow}>Profil pilote</p><h1 className={styles.title}>Votre expérience de pilote</h1><p className={styles.subtitle}>Indiquez simplement votre expérience acquise avant Balloon Companion.</p></header>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!valid) return; persistPilotExperience({ hours, minutes, ascensions }); router.push("/more/profile"); }}>
      <label><span>Heures</span><input autoFocus inputMode="numeric" pattern="[0-9]*" value={values.hours} onChange={(e) => setNumeric("hours", e.target.value)} /></label>
      <label><span>Minutes</span><input inputMode="numeric" pattern="[0-9]*" aria-invalid={minutes > 59} value={values.minutes} onChange={(e) => setNumeric("minutes", e.target.value)} /></label>
      <label><span>Ascensions</span><input inputMode="numeric" pattern="[0-9]*" value={values.ascensions} onChange={(e) => setNumeric("ascensions", e.target.value)} /></label>
      <div className={styles.actions} style={{ gridColumn: "1 / -1" }}><button type="submit" disabled={!valid}>Enregistrer mon expérience</button>{!values.confirmed && <button type="button" className={styles.later} onClick={() => router.push("/more")}>Plus tard</button>}</div>
    </form>
  </div></main>;
}
