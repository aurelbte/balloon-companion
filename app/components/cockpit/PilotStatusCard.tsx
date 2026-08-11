"use client";

import { BadgeCheck, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../design-system";
import { useFlightCompletionState } from "../../hooks/useFlightCompletionState";
import { usePilotProfile } from "../../hooks/usePilotProfile";
import { calculatePilotOfficialTotals } from "../../lib/flightCompletion";
import { formatProfileDate, remainingMonthsUntil } from "../../lib/pilotProfile";
import styles from "./Cockpit.module.css";

type CredentialVisualStatus = "valid" | "attention" | "expired" | "unknown";

function credentialStatus(dateIso: string, now: Date): CredentialVisualStatus {
  if (!dateIso) return "unknown";
  const due = new Date(`${dateIso}T23:59:59`);
  if (!Number.isFinite(due.getTime())) return "unknown";
  if (due.getTime() < now.getTime()) return "expired";
  return remainingMonthsUntil(dateIso, now) === 0 ? "attention" : "valid";
}

function statusLabel(status: CredentialVisualStatus): string {
  if (status === "valid") return "Valide";
  if (status === "attention") return "Attention";
  if (status === "expired") return "Expiré";
  return "Non renseigné";
}

export default function PilotStatusCard() {
  const router = useRouter();
  const profile = usePilotProfile();
  const completion = useFlightCompletionState();
  const [open, setOpen] = useState(false);
  const now = new Date();
  const rows = [
    { label: "Vol test", dateIso: profile.flightTestDueDateIso },
    { label: "Médical", dateIso: profile.medicalDueDateIso },
  ];
  const credentialRows = rows.map((row) => ({
    ...row,
    visualStatus: credentialStatus(row.dateIso, now),
  }));
  const globalStatus = credentialRows.some(({ visualStatus }) => visualStatus === "expired")
    ? { label: "Non conforme", visualStatus: "danger" }
    : credentialRows.every(({ visualStatus }) => visualStatus === "unknown")
      ? { label: "Non renseigné", visualStatus: "unknown" }
    : credentialRows.some(({ visualStatus }) => visualStatus !== "valid")
      ? { label: "Attention", visualStatus: "attention" }
      : { label: "Prêt à voler", visualStatus: "valid" };
  const totals = useMemo(() => calculatePilotOfficialTotals(completion), [completion]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={styles.pilotStatusTrigger}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Card className={`${styles.card} ${styles.summaryCard}`}>
          <h2 className={styles.cardTitle}>
            <BadgeCheck size={15} aria-hidden="true" />
            Statut pilote
          </h2>
          <div className={styles.rows}>
            <div className={styles.row}>
              <span className={styles.label}>Statut global</span>
              <strong className={styles.statusValue} data-status={globalStatus.visualStatus}>
                <span className={styles.statusDot} aria-hidden="true" />
                {globalStatus.label}
              </strong>
            </div>
            {credentialRows.map(({ label, visualStatus }) => (
              <div className={styles.row} key={label}>
                <span className={styles.label}>{label}</span>
                <strong
                  className={styles.statusValue}
                  data-status={visualStatus === "expired" ? "danger" : visualStatus}
                >
                  <span className={styles.statusDot} aria-hidden="true" />
                  {statusLabel(visualStatus)}
                </strong>
              </div>
            ))}
          </div>
          <span className={styles.cardAction}>Voir le détail →</span>
        </Card>
      </button>

      {open && (
        <section
          className={styles.pilotStatusDetail}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pilot-status-detail-title"
        >
          <header className={styles.pilotStatusDetailHeader}>
            <h2 id="pilot-status-detail-title">Statut pilote</h2>
            <button
              type="button"
              className={styles.pilotStatusClose}
              onClick={() => setOpen(false)}
              aria-label="Fermer la fiche Statut pilote"
              autoFocus
            >
              <X size={24} aria-hidden="true" />
            </button>
          </header>

          <div className={styles.pilotStatusDetailContent}>
            <article className={styles.pilotStatusBlock}>
              <div className={styles.pilotStatusBlockHeader}>
                <h3>Licence</h3>
              </div>
              <dl className={styles.pilotStatusFacts}>
                <div><dt>Numéro</dt><dd>{profile.licenseNumber || "Non renseigné"}</dd></div>
                <div><dt>Fonction</dt><dd>{profile.usualFunction ?? "Non renseignée"}</dd></div>
              </dl>
            </article>

            {rows.map(({ label, dateIso }) => {
              const visualStatus = credentialStatus(dateIso, now);
              return (
                <article className={styles.pilotStatusBlock} key={label}>
                  <div className={styles.pilotStatusBlockHeader}>
                    <h3>{label}</h3>
                    <span className={styles.pilotStatusBadge} data-status={visualStatus}>
                      <span aria-hidden="true" />{statusLabel(visualStatus)}
                    </span>
                  </div>
                  <dl className={styles.pilotStatusFacts}>
                    <div><dt>Échéance</dt><dd>{formatProfileDate(dateIso) ?? "Non renseignée"}</dd></div>
                    <div><dt>État</dt><dd>{statusLabel(visualStatus)}</dd></div>
                  </dl>
                </article>
              );
            })}

            <article className={styles.pilotStatusBlock}>
              <div className={styles.pilotStatusBlockHeader}><h3>Expérience</h3></div>
              <dl className={styles.pilotStatusFacts}>
                <div>
                  <dt>Heures de vol</dt>
                  <dd>{totals.officialDurationMinutes === null ? "Non renseignées" : `${Math.floor(totals.officialDurationMinutes / 60)} h ${totals.remainingMinutes} min`}</dd>
                </div>
                <div><dt>Nombre de vols</dt><dd>{totals.ascensions ?? "Non renseigné"}</dd></div>
              </dl>
            </article>
          </div>

          <footer className={styles.pilotStatusDetailFooter}>
            <button
              type="button"
              onClick={() => router.push("/more/profile/experience")}
            >
              <Pencil size={17} aria-hidden="true" />
              Modifier
            </button>
          </footer>
        </section>
      )}
    </>
  );
}
