"use client";

import { useEffect, useState } from "react";
import type { Ascension } from "../../lib/ascensionMockData";
import type { JournalFlight } from "../../lib/journalMockData";
import styles from "../../journal/Journal.module.css";
import AscensionLog from "./AscensionLog";
import JournalFlightList from "./JournalFlightList";

type JournalView = "flights" | "logbook";
const SESSION_KEY = "balloon-companion-journal-view";

type JournalHubProps = {
  flights: readonly JournalFlight[];
  ascensions: readonly Ascension[];
};

export default function JournalHub({ flights, ascensions }: JournalHubProps) {
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
          <JournalFlightList flights={flights} />
        ) : (
          <AscensionLog ascensions={ascensions} />
        )}
      </div>
    </>
  );
}
