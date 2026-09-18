"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import OfficialAscensionForm, {
  type OfficialAscensionFormValues,
} from "../../../components/journal/OfficialAscensionForm";
import { persistManualOfficialAscension } from "../../../lib/flightCompletionStorage";

const EMPTY_VALUES: OfficialAscensionFormValues = {
  dateIso: "",
  balloonModel: "",
  balloonManufacturer: "",
  registration: "",
  departure: "",
  arrival: "",
  category: "",
  pilotFunction: "",
  regulatoryRole: null,
  supervisedByFiB: null,
  nightFlight: null,
  maximumAltitudeM: "",
  officialDurationMinutes: null,
  flightNature: "STANDARD",
  takeoffCount: "1",
  landingCount: "1",
  instructorName: "",
  instructorLicenceNumber: "",
  examinerName: "",
  examinerLicenceNumber: "",
  observations: "",
};

export default function NewAscensionPage() {
  const router = useRouter();
  const [saveError, setSaveError] = useState<string | null>(null);
  const submitting = useRef(false);
  const [postSaveError, setPostSaveError] = useState<string | null>(null);
  const navigateAfterSave = () => {
    try {
      router.push("/journal");
    } catch {
      setPostSaveError("L’ascension est bien enregistrée. La navigation n’a pas pu se terminer. Réessayez le retour sans enregistrer à nouveau.");
    }
  };

  if (postSaveError) return (
    <main className="p-5">
      <h1>Ascension enregistrée</h1>
      <p role="alert">{postSaveError}</p>
      <button type="button" onClick={navigateAfterSave}>Réessayer le retour</button>
    </main>
  );

  return (
    <OfficialAscensionForm
      submissionError={saveError}
      mode="CREATE"
      title="Nouvelle ascension"
      subtitle="Saisie manuelle sans trace GPS"
      backLabel="Carnet d’ascensions"
      submitLabel="Ajouter l’ascension"
      manualDateEntry
      initialValues={EMPTY_VALUES}
      onCancel={(dirty) => {
        if (!dirty || window.confirm("Quitter sans enregistrer les modifications ?")) {
          window.sessionStorage.setItem("balloon-companion-journal-view", "logbook");
          router.push("/journal");
        }
      }}
      onSubmit={(input) => {
        if (submitting.current) return false;
        submitting.current = true;
        try {
          persistManualOfficialAscension(input);
        } catch {
          submitting.current = false;
          setSaveError("Impossible d’enregistrer l’ascension. Réessayez.");
          return false;
        }
        setSaveError(null);
        try {
          window.sessionStorage.setItem("balloon-companion-journal-view", "logbook");
          window.sessionStorage.setItem("balloon-companion-ascension-added", "1");
        } catch { /* Optional UI markers must not block navigation after saving. */ }
        navigateAfterSave();
        return true;
      }}
    />
  );
}
