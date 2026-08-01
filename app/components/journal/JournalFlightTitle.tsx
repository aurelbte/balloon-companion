"use client";

import { useEffect, useState } from "react";
import { loadJournalDemoState } from "../../lib/journalDemoStorage";

type JournalFlightTitleProps = {
  flightId: string;
  automaticName: string;
  availableFlightIds: readonly string[];
  className?: string;
};

export default function JournalFlightTitle({
  flightId,
  automaticName,
  availableFlightIds,
  className,
}: JournalFlightTitleProps) {
  const [title, setTitle] = useState(automaticName);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const state = loadJournalDemoState(availableFlightIds);
      setTitle(state.customNames[flightId] ?? automaticName);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [automaticName, availableFlightIds, flightId]);

  return <h1 className={className}>{title}</h1>;
}
