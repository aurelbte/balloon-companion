"use client";

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
  nightFlight: null,
  maximumAltitudeM: "",
  officialDurationMinutes: null,
  observations: "",
};

export default function NewAscensionPage() {
  const router = useRouter();
  return (
    <OfficialAscensionForm
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
        persistManualOfficialAscension(input);
        window.sessionStorage.setItem("balloon-companion-journal-view", "logbook");
        window.sessionStorage.setItem("balloon-companion-ascension-added", "1");
        router.push("/journal");
      }}
    />
  );
}
