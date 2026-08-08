"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import OfficialAscensionForm, {
  type OfficialAscensionFormValues,
} from "../../../components/journal/OfficialAscensionForm";
import {
  defaultOfficialAscensionInput,
  DEMO_COMPLETION_FLIGHT_ID,
} from "../../../lib/flightCompletion";
import {
  ensureDemoCompletionPersisted,
  loadFlightCompletionState,
  persistOfficialAscension,
} from "../../../lib/flightCompletionStorage";
import { loadBalloonRegistry } from "../../../lib/balloonStorage";
import { officialFieldsForBalloon, resolveBalloonForFlight } from "../../../lib/balloons";
import { loadPreparationDraft } from "../../../lib/preparationDraftStorage";
import { useFlightCompletionState } from "../../../hooks/useFlightCompletionState";

function toFormValues(flightId: string): OfficialAscensionFormValues {
  const defaults = defaultOfficialAscensionInput();
  const state = loadFlightCompletionState();
  const flight = state.journalFlights.find(({ id }) => id === flightId);
  const existing = state.officialAscensions.find(({ sourceFlightId }) => sourceFlightId === flightId);
  const preparationBalloonId = loadPreparationDraft()?.balloonName;
  const registry = loadBalloonRegistry();
  const selectedBalloon = resolveBalloonForFlight(registry.balloons, preparationBalloonId, registry.activeBalloonId);
  const flightValues = flight ? { dateIso: flight.dateIso, date: flight.date, registration: flight.balloonRegistration, departure: flight.departure, arrival: flight.arrival, maximumAltitudeM: flight.maxAltitudeM, officialDurationMinutes: flight.durationMinutes } : {};
  const value = existing ?? { ...defaults, ...flightValues, ...(selectedBalloon ? officialFieldsForBalloon(selectedBalloon) : {}) };
  return {
    dateIso: value.dateIso,
    balloonModel: value.balloonModel,
    balloonManufacturer: value.balloonManufacturer ?? "",
    registration: value.registration,
    departure: value.departure,
    arrival: value.arrival,
    category: value.category,
    pilotFunction: value.pilotFunction,
    nightFlight: value.nightFlight,
    maximumAltitudeM: value.maximumAltitudeM === null ? "" : String(value.maximumAltitudeM),
    officialDurationMinutes: value.officialDurationMinutes,
    observations: value.observations,
  };
}

function ValidateAscensionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const flightId = searchParams.get("flightId") ?? DEMO_COMPLETION_FLIGHT_ID;
  const completionState = useFlightCompletionState();
  const sourceFlight = completionState.journalFlights.find(({ id }) => id === flightId);
  const [initialValues, setInitialValues] = useState<OfficialAscensionFormValues | null>(null);

  useEffect(() => {
    if (flightId === DEMO_COMPLETION_FLIGHT_ID) ensureDemoCompletionPersisted();
    const timer = window.setTimeout(() => setInitialValues(toFormValues(flightId)), 0);
    return () => window.clearTimeout(timer);
  }, [flightId]);

  if (!initialValues) return null;

  return (
    <OfficialAscensionForm
      mode="VALIDATE"
      title="Valider l’ascension"
      backLabel="Synthèse du vol"
      submitLabel="Valider l’ascension"
      gpsDurationMinutes={sourceFlight?.durationMinutes}
      initialValues={initialValues}
      onCancel={(dirty) => {
        if (!dirty || window.confirm("Quitter sans enregistrer les modifications ?")) {
          router.push(`/journal/${encodeURIComponent(flightId)}`);
        }
      }}
      onSubmit={(input) => {
        persistOfficialAscension(flightId, input);
        window.sessionStorage.setItem("balloon-companion-journal-view", "logbook");
        router.push("/journal");
      }}
    />
  );
}

export default function ValidateAscensionPage() {
  return <Suspense fallback={null}><ValidateAscensionContent /></Suspense>;
}
