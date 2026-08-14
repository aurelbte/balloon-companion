"use client";

import Link from "next/link";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import { formatOfficialDuration } from "../../lib/ascensionMockData";
import styles from "../../journal/Journal.module.css";
import { useUnitPreferences } from "../../contexts/UnitPreferencesContext";
import { formatFlightAltitude } from "../../lib/unitPreferences";

export default function CompletionAscensionDetail({ ascensionId }: { ascensionId: string }) {
  const units = useUnitPreferences();
  const state = useFlightCompletionState();
  const ascension = state.officialAscensions.find(
    ({ id }) => id === ascensionId,
  );

  if (!ascension) {
    return <p className={styles.emptyState}>Cette ascension n’est pas encore validée.</p>;
  }

  const fields = [
    ["Date", ascension.date],
    ["Type de ballon", `${ascension.balloonModel} · ${ascension.category}`],
    ["Constructeur", ascension.balloonManufacturer || "—"],
    ["Immatriculation", ascension.registration],
    ["Lieu d’envol", ascension.departure],
    ["Lieu d’atterrissage", ascension.arrival],
    ["Fonction", ascension.pilotFunction],
    ["Vol de nuit", ascension.nightFlight ? "Oui" : "Non"],
    ["Altitude atteinte", ascension.maximumAltitudeM === null ? "—" : formatFlightAltitude(ascension.maximumAltitudeM, units.flightInstruments.altitudeUnit)],
    ["Temps officiel", formatOfficialDuration(ascension.officialDurationMinutes)],
    ["Origine", "GPS · Balloon Companion"],
  ] as const;

  return (
    <>
      <header className={styles.detailHeader}>
        <p className={styles.eyebrow}>Ascension</p>
        <div className={styles.ascensionDetailTitleRow}>
          <h1 className={styles.routeTitle}>{ascension.departure} → {ascension.arrival}</h1>
          <Link className={styles.ascensionEditLink} href={`/journal/ascension/${ascension.id}/edit`}>Modifier</Link>
        </div>
      </header>
      <section className={styles.ascensionDetailGrid} aria-label="Informations officielles">
        {fields.map(([label, value]) => (
          <article key={label} className={styles.ascensionDetailCard}>
            <p>{label}</p><strong>{value}</strong>
          </article>
        ))}
      </section>
      <article className={styles.ascensionObservation}>
        <p>Observations</p><strong>{ascension.observations || "—"}</strong>
      </article>
    </>
  );
}
