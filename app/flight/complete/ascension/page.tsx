"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

function toFormValues(): OfficialAscensionFormValues {
  const defaults = defaultOfficialAscensionInput();
  const existing = loadFlightCompletionState().officialAscensions.find(
    ({ sourceFlightId }) => sourceFlightId === DEMO_COMPLETION_FLIGHT_ID,
  );
  const preparationBalloonId = loadPreparationDraft()?.balloonName;
  const registry = loadBalloonRegistry();
  const selectedBalloon = resolveBalloonForFlight(registry.balloons, preparationBalloonId, registry.activeBalloonId);
  const value = existing ?? (selectedBalloon ? { ...defaults, ...officialFieldsForBalloon(selectedBalloon) } : defaults);
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

export default function ValidateAscensionPage() {
  const router = useRouter();
  const [initialValues, setInitialValues] = useState<OfficialAscensionFormValues | null>(null);

  useEffect(() => {
    ensureDemoCompletionPersisted();
    const timer = window.setTimeout(() => setInitialValues(toFormValues()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!initialValues) return null;

  return (
    <OfficialAscensionForm
      title="Valider l’ascension"
      backLabel="Synthèse du vol"
      submitLabel="Valider l’ascension"
      gpsDurationMinutes={57}
      initialValues={initialValues}
      onCancel={(dirty) => {
        if (!dirty || window.confirm("Quitter sans enregistrer les modifications ?")) {
          router.push("/flight/complete");
        }
      }}
      onSubmit={(input) => {
        persistOfficialAscension(DEMO_COMPLETION_FLIGHT_ID, input);
        window.sessionStorage.setItem("balloon-companion-journal-view", "logbook");
        router.push("/journal");
      }}
    />
  );
}
