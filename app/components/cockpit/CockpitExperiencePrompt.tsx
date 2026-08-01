"use client";

import Link from "next/link";
import { useState } from "react";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import styles from "./Cockpit.module.css";

export default function CockpitExperiencePrompt() {
  const state = useFlightCompletionState();
  const [deferred, setDeferred] = useState(() =>
    typeof window !== "undefined" &&
    window.sessionStorage.getItem("balloon-companion-experience-deferred") === "1"
  );
  if (state.openingBalance.confirmed || deferred) return null;
  return (
    <aside className={styles.experiencePrompt}>
      <div><strong>Expérience antérieure</strong><p>Complétez le point de départ de votre Carnet.</p></div>
      <Link href="/more/profile/experience">Compléter</Link>
      <button type="button" onClick={() => { window.sessionStorage.setItem("balloon-companion-experience-deferred", "1"); setDeferred(true); }}>Plus tard</button>
    </aside>
  );
}
