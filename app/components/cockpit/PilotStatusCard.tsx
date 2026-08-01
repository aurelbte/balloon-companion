"use client";
import { BadgeCheck } from "lucide-react";
import { Card } from "../../design-system";
import { usePilotProfile } from "../../hooks/usePilotProfile";
import { formatProfileDate, remainingMonthsUntil } from "../../lib/pilotProfile";
import styles from "./Cockpit.module.css";
export default function PilotStatusCard() { const profile = usePilotProfile(); const now = new Date(); const rows = [{ label: "Vol test", dateIso: profile.flightTestDueDateIso }, { label: "Médical", dateIso: profile.medicalDueDateIso }]; return <Card className={styles.card}><h2 className={styles.cardTitle}><BadgeCheck size={15} aria-hidden="true" />Statut pilote</h2><div className={styles.rows}>{rows.map(({ label, dateIso }) => { const months = remainingMonthsUntil(dateIso, now); const dueDate = formatProfileDate(dateIso); return <div className={styles.credentialRow} key={label}><span className={styles.credentialLabel}>{label}</span><strong className={styles.credentialRemaining}>{months === null ? "Non renseigné" : `${months} mois restants`}</strong><span className={styles.credentialDueDate}>Échéance&nbsp;: {dueDate ?? "Non renseignée"}</span></div>; })}</div></Card>; }
