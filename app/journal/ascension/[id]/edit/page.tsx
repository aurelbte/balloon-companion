"use client";

import { useParams, useRouter } from "next/navigation";
import OfficialAscensionForm from "../../../../components/journal/OfficialAscensionForm";
import { useFlightCompletionState } from "../../../../hooks/useFlightCompletionState";
import { officialAscensionToEditValues } from "../../../../lib/officialAscensionEditing";
import { persistOfficialAscensionUpdate } from "../../../../lib/flightCompletionStorage";
import styles from "../../../Journal.module.css";

export default function EditAscensionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const state = useFlightCompletionState();
  const ascension = state.officialAscensions.find((item) => item.id === id);

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
        if (process.env.NODE_ENV === "development") console.debug("[EditAscensionPage] branch", { ascensionId: id, branch: "UPDATE" });
        const updated = persistOfficialAscensionUpdate(id, input);
        if (!updated) return false;
        window.sessionStorage.setItem("balloon-companion-journal-view", "logbook");
        returnToDetail();
        return true;
      }}
    />
  );
}
