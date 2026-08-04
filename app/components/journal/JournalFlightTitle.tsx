"use client";

import { useEffect, useState } from "react";
import { loadJournalDemoState } from "../../lib/journalDemoStorage";

type JournalFlightTitleProps = {
  flightId: string;
  automaticName: string;
  availableFlightIds: readonly string[];
  className?: string;
  secondaryClassName?: string;
  secondaryName?: string;
};

export default function JournalFlightTitle({
  flightId,
  automaticName,
  availableFlightIds,
  className,
  secondaryClassName,
  secondaryName = automaticName,
}: JournalFlightTitleProps) {
  const [title, setTitle] = useState(automaticName);
  const customized = title !== automaticName;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const state = loadJournalDemoState(availableFlightIds);
      setTitle(state.customNames[flightId] ?? automaticName);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [automaticName, availableFlightIds, flightId]);

  return <>
    <h1 className={className}>{title}</h1>
    {customized && <p className={secondaryClassName}>{secondaryName}</p>}
  </>;
}
