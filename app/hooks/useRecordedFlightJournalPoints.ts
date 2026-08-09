"use client";

import { useEffect, useState } from "react";
import type { JournalFlight, JournalFlightPoint } from "../lib/journalMockData";
import { loadRecordedFlightForJournal } from "../lib/flightCompletionStorage";
import { recordedFlightPointsToJournalPoints } from "../lib/realFlightJournal";

export function useRecordedFlightJournalPoints(
  flight: JournalFlight,
): readonly JournalFlightPoint[] {
  const [points, setPoints] = useState(flight.points);

  useEffect(() => {
    setPoints(flight.points);
    if (flight.points.length > 0 || flight.origin !== "REAL_GPS") return;
    let active = true;
    const sourceFlightId = (flight as JournalFlight & { sourceFlightId?: string }).sourceFlightId ?? flight.id;
    void loadRecordedFlightForJournal(sourceFlightId)
      .then((recorded) => {
        if (active && recorded) setPoints(recordedFlightPointsToJournalPoints(recorded));
      })
      .catch((error: unknown) => {
        if (process.env.NODE_ENV === "development") {
          console.error("[Journal] Relecture de la trace IndexedDB impossible", error);
        }
      });
    return () => { active = false; };
  }, [flight]);

  return points;
}
