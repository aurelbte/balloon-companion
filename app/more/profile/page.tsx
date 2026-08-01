"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import NavigationBar from "../../components/NavigationBar";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import { formatOfficialDuration } from "../../lib/ascensionMockData";
import styles from "../More.module.css";

export default function PilotProfilePage() {
  const state = useFlightCompletionState();
  const balance = state.openingBalance;
  return <main className={styles.screen}><div className={styles.layout}>
    <Link href="/more" className={styles.back}><ChevronLeft size={18} aria-hidden="true" /> Plus</Link>
    <header><p className={styles.eyebrow}>Profil pilote</p><h1 className={styles.title}>Expérience antérieure</h1></header>
    <section className={styles.experienceCard}>
      <h2>Expérience avant Balloon Companion</h2>
      {balance.confirmed && balance.officialDurationMinutes !== null && balance.ascensions !== null ? <>
        <p className={styles.experienceValue}>{formatOfficialDuration(balance.officialDurationMinutes)}</p>
        <p className={styles.experienceValue}>{balance.ascensions} ascension{balance.ascensions > 1 ? "s" : ""}</p>
      </> : <p className={styles.experienceValue}>Non renseignée</p>}
      <p className={styles.experienceHint}>Ces valeurs servent de point de départ à votre Carnet d’ascensions et au Cockpit.</p>
      <Link href="/more/profile/experience" className={styles.modify}>{balance.confirmed ? "Modifier" : "Compléter mon expérience"}</Link>
    </section>
  </div><NavigationBar activeItem="Plus" /></main>;
}
