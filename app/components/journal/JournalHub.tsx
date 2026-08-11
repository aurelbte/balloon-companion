"use client";

import { useEffect, useState } from "react";
import styles from "../../journal/Journal.module.css";
import AscensionLog from "./AscensionLog";
import JournalFlightList from "./JournalFlightList";

type JournalView = "flights" | "logbook";
const SESSION_KEY = "balloon-companion-journal-view";

export default function JournalHub() {
  const [activeView, setActiveView] = useState<JournalView>("flights");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.sessionStorage.getItem(SESSION_KEY);
      if (stored === "flights" || stored === "logbook") setActiveView(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const selectView = (view: JournalView) => {
    setActiveView(view);
    window.sessionStorage.setItem(SESSION_KEY, view);
  };

  return (
    <>
      <div className={styles.segmentedControl} role="tablist" aria-label="Vue du Journal">
        <span
          className={styles.segmentedSelection}
          data-position={activeView}
          aria-hidden="true"
        />
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "flights"}
          onClick={() => selectView("flights")}
        >
          Mes vols
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "logbook"}
          onClick={() => selectView("logbook")}
        >
          Carnet
        </button>
      </div>

      <div role="tabpanel">
        {activeView === "flights" ? (
          <JournalFlightList />
        ) : (
          <AscensionLog />
        )}
      </div>
    </>
  );
}
