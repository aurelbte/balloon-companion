"use client";

import { useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import OfficialAscensionForm from "../../../../components/journal/OfficialAscensionForm";
import { useFlightCompletionState } from "../../../../hooks/useFlightCompletionState";
import { officialAscensionToEditValues } from "../../../../lib/officialAscensionEditing";
import { persistOfficialAscensionUpdate } from "../../../../lib/flightCompletionStorage";
import styles from "../../../Journal.module.css";

export default function EditAscensionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [saveError, setSaveError] = useState<string | null>(null);
  const submitting = useRef(false);
  const [postSaveError, setPostSaveError] = useState<string | null>(null);
  const state = useFlightCompletionState();
  const ascension = state.officialAscensions.find((item) => item.id === id);

  const navigateAfterSave = () => {
    try {
      router.push(`/journal/ascension/${id}`);
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

  if (!ascension) {
    return (
      <main className={styles.screen}>
        <div className={styles.layout}>
          <p className={styles.emptyState}>Cette ascension ne peut pas être modifiée.</p>
        </div>
      </main>
    );
  }

  const returnToDetail = () => router.push(`/journal/ascension/${id}`);

  return (
    <OfficialAscensionForm
      submissionError={saveError}
      mode="EDIT"
      ascensionId={id}
      title="Modifier l’ascension"
      subtitle={`${ascension.departure} → ${ascension.arrival}`}
      backLabel="Ascension"
      submitLabel="Enregistrer"
      nativeSubmit
      gpsDurationMinutes={ascension.gpsDurationMinutes ?? undefined}
      initialValues={officialAscensionToEditValues(ascension)}
      onCancel={(dirty) => {
        if (!dirty || window.confirm("Quitter sans enregistrer les modifications ?")) {
          returnToDetail();
        }
      }}
      onSubmit={(input) => {
        if (submitting.current) return false;
        submitting.current = true;
        if (process.env.NODE_ENV === "development") console.debug("[EditAscensionPage] branch", { ascensionId: id, branch: "UPDATE" });
        try {
          if (!persistOfficialAscensionUpdate(id, input)) throw new Error("Ascension introuvable");
        } catch {
          submitting.current = false;
          setSaveError("Impossible de modifier l’ascension. Réessayez.");
          return false;
        }
        setSaveError(null);
        try {
          window.sessionStorage.setItem("balloon-companion-journal-view", "logbook");
        } catch { /* Optional UI markers must not block navigation after saving. */ }
        navigateAfterSave();
        return true;
      }}
    />
  );
}
