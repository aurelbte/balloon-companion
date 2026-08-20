"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import NavigationBar from "../../../components/NavigationBar";
import { useFlightCompletionState } from "../../../hooks/useFlightCompletionState";
import { calculateBplMaintenance, type QualificationRequirementResult, type QualificationRequirementStatus } from "../../../lib/bplQualificationEngine";
import { calculateCommercialQualification, OFFICIAL_ASCENSION_CLASS_IDS } from "../../../lib/commercialQualificationEngine";
import { calculateMedicalQualification, calculateProfessionalTrainingStatus } from "../../../lib/medicalTrainingQualificationEngine";
import { bplEventCredits } from "../../../lib/qualificationEventCredits";
import { formatQualificationDate, mostRestrictiveQualificationResult, qualificationClassLabel, qualificationEventLabel, qualificationStatusLabel } from "../../../lib/qualificationPresentation";
import type { QualificationBalloonClass, QualificationEvent, QualificationProfile, PilotQualificationsState } from "../../../lib/pilotQualifications";
import { loadPilotQualifications, savePilotQualifications } from "../../../lib/pilotQualificationsStorage";
import moreStyles from "../../More.module.css";
import styles from "./Qualifications.module.css";

function localIsoDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: QualificationRequirementStatus }) {
  return <span className={styles.status} data-status={status}>{qualificationStatusLabel(status)}</span>;
}

function pilotStatusLabel(status: QualificationRequirementStatus, medical = false): string {
  if (status === "UNKNOWN") return "À compléter";
  if (status === "COMPLIANT") return medical ? "Valide" : "À jour";
  if (status === "WARNING" || status === "UPCOMING") return medical ? "Expire bientôt" : "Attention";
  if (status === "ACTION_REQUIRED") return medical ? "Expiré" : "Action requise";
  return "Non concerné";
}

function CompactRequirement({ title, result, children }: { title: string; result: QualificationRequirementResult; children?: ReactNode }) {
  return <article className={styles.compactRequirement}><div><h3>{title}</h3>{children}<details><summary>Détails</summary><p>{result.reason}</p></details></div><StatusBadge status={result.status} /></article>;
}

function QualificationSettingsForm({ priority = false, settings, onChange, onSubmit }: {
  priority?: boolean;
  settings: QualificationProfile;
  onChange: (settings: QualificationProfile) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form className={`${styles.settings} ${priority ? styles.prioritySettings : ""}`} onSubmit={onSubmit}>
    <h2>{priority ? "Configurer votre profil" : "Modifier ma situation"}</h2>
    {priority && <p className={styles.priorityText}>Configurez votre profil pour calculer vos qualifications et validités.</p>}
    <div className={styles.settingsGrid}>
      <label htmlFor="qualification-licence-type"><span>Type de licence</span><select id="qualification-licence-type" value={settings.licenceType ?? ""} onChange={(event) => onChange({ ...settings, licenceType: event.target.value || null })}><option value="">Non renseigné</option><option value="BPL">BPL</option><option value="OTHER">Autre</option></select></label>
      <label className={styles.toggle} htmlFor="qualification-commercial"><input id="qualification-commercial" type="checkbox" checked={settings.commercialOperationsEnabled} onChange={(event) => onChange({ ...settings, commercialOperationsEnabled: event.target.checked })} /><span>Activité commerciale</span></label>
      <label className={styles.toggle} htmlFor="qualification-fi-b"><input id="qualification-fi-b" type="checkbox" checked={settings.fiBEnabled} onChange={(event) => onChange({ ...settings, fiBEnabled: event.target.checked })} /><span>Qualification FI(B)</span></label>
      <label className={styles.toggle} htmlFor="qualification-fe-b"><input id="qualification-fe-b" type="checkbox" checked={settings.feBEnabled} onChange={(event) => onChange({ ...settings, feBEnabled: event.target.checked })} /><span>Qualification FE(B)</span></label>
    </div>
    <button className={styles.save} type="submit">Enregistrer</button>
  </form>;
}

function eventClassKeys(events: readonly QualificationEvent[], ascensions: PilotQualificationsPageState["completion"]["officialAscensions"]): QualificationBalloonClass[] {
  const values = [
    ...events.flatMap(({ balloonClass }) => balloonClass ? [balloonClass] : []),
    ...ascensions.map((ascension): QualificationBalloonClass => ({ classId: OFFICIAL_ASCENSION_CLASS_IDS[ascension.category] })),
  ];
  return [...new Map(values.map((value) => [`${value.classId}:${value.groupId ?? ""}`, value])).values()];
}

type PilotQualificationsPageState = Readonly<{
  qualifications: PilotQualificationsState;
  completion: ReturnType<typeof useFlightCompletionState>;
}>;

export default function QualificationsPage() {
  const completion = useFlightCompletionState();
  const [qualifications, setQualifications] = useState<PilotQualificationsState | null>(null);
  const [settings, setSettings] = useState<QualificationProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const lastSubmittedProfile = useRef<string | null>(null);
  const referenceDateIso = localIsoDate();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadPilotQualifications(window.localStorage);
      setQualifications(loaded);
      setSettings(loaded.profile);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const view = useMemo(() => {
    if (!qualifications || !qualifications.profile.configured) return null;
    const bpl = calculateBplMaintenance({ profile: qualifications.profile, events: qualifications.events, ascensions: completion.officialAscensions, referenceDateIso, ascensionHistoryComplete: true, openingBalance: completion.openingBalance });
    const medical = calculateMedicalQualification({ events: qualifications.events, legacy: qualifications.legacy, referenceDateIso, requiredClass: "LAPL" });
    const commercialClasses = eventClassKeys(qualifications.events, completion.officialAscensions);
    const commercial = qualifications.profile.commercialOperationsEnabled
      ? commercialClasses.map((balloonClass) => calculateCommercialQualification({ profile: qualifications.profile, events: qualifications.events, ascensions: completion.officialAscensions, referenceDateIso, balloonClass, ascensionHistoryComplete: true }))
      : [];
    const credits = bplEventCredits(qualifications.events).filter(({ creditedFrom }) => creditedFrom === "COMMERCIAL_PROFICIENCY_CHECK" || creditedFrom === "COMMERCIAL_REFRESHER_COURSE");
    return { bpl, medical, commercialClasses, commercial, credits };
  }, [completion, qualifications, referenceDateIso]);

  if (!qualifications || !settings) return null;

  const submitSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const configuredSettings = { ...settings, configured: true };
    const submissionKey = JSON.stringify(configuredSettings);
    if (lastSubmittedProfile.current === submissionKey) return;
    lastSubmittedProfile.current = submissionKey;
    const next = { ...qualifications, profile: configuredSettings };
    if (savePilotQualifications({ profile: configuredSettings, events: qualifications.events }, window.localStorage)) {
      setSettings(configuredSettings);
      setQualifications(next);
      setEditing(false);
    } else {
      lastSubmittedProfile.current = null;
    }
  };

  if (!qualifications.profile.configured) return <main className={moreStyles.screen}><div className={moreStyles.layout}>
    <Link href="/more/profile" className={moreStyles.back}><ChevronLeft size={18} aria-hidden="true" /> Profil pilote</Link>
    <header><p className={moreStyles.eyebrow}>Profil pilote</p><h1 className={moreStyles.title}>Qualifications &amp; validité</h1></header>
    <QualificationSettingsForm priority settings={settings} onChange={setSettings} onSubmit={submitSettings} />
  </div><NavigationBar activeItem="Plus" /></main>;

  if (!view) return null;
  const experience = view.bpl.recentExperience.currentValue ?? { officialDurationMinutes: 0, ascensions: 0, takeoffs: 0, landings: 0 };
  const medicalEvent = [...qualifications.events].filter(({ type }) => type === "MEDICAL").sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0];
  const firstAid = calculateProfessionalTrainingStatus({ profile: qualifications.profile, events: qualifications.events, type: "FIRST_AID", referenceDateIso });
  const fire = calculateProfessionalTrainingStatus({ profile: qualifications.profile, events: qualifications.events, type: "FIRE_TRAINING", referenceDateIso });
  const otherEvents = qualifications.events.filter(({ type }) => type === "OTHER_TRAINING").sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  const history = [...qualifications.events].sort((a, b) => b.dateIso.localeCompare(a.dateIso) || b.createdAt.localeCompare(a.createdAt));
  const unknownCommercial: QualificationRequirementResult = { status: "UNKNOWN", reason: "Classe commerciale inconnue." };
  const commercialSummary = view.commercial.length ? mostRestrictiveQualificationResult(view.commercial.map(({ overall }) => overall)) : unknownCommercial;
  const summary: Array<readonly [string, QualificationRequirementResult]> = [
    ["BPL", view.bpl.overall],
    ["Médical", view.medical.overall],
    ...(qualifications.profile.commercialOperationsEnabled ? [["Activité professionnelle", commercialSummary] as const] : []),
  ];
  const actionItems = [
    ...(!medicalEvent?.medicalClass ? ["Renseigner votre classe médicale dans l’historique"] : []),
    ...(view.bpl.trainingFlightFiB.status === "UNKNOWN" ? ["Enregistrer votre dernier vol d’entraînement dans l’historique"] : []),
    ...(view.bpl.proficiencyCheckFeB.status === "UNKNOWN" ? ["Enregistrer votre dernier contrôle de compétences dans l’historique"] : []),
    ...(qualifications.profile.commercialOperationsEnabled && firstAid.status === "UNKNOWN" ? ["Renseigner votre formation PSC1 dans l’historique"] : []),
    ...(qualifications.profile.commercialOperationsEnabled && fire.status === "UNKNOWN" ? ["Renseigner votre formation incendie dans l’historique"] : []),
  ];

  return <main className={moreStyles.screen}><div className={moreStyles.layout}>
    <Link href="/more/profile" className={moreStyles.back}><ChevronLeft size={18} aria-hidden="true" /> Profil pilote</Link>
    <header className={styles.header}><div><p className={moreStyles.eyebrow}>Profil pilote</p><h1 className={moreStyles.title}>Qualifications &amp; validité</h1></div><button className={styles.edit} type="button" onClick={() => setEditing((value) => !value)}>Modifier ma situation</button></header>

    {editing && <QualificationSettingsForm settings={settings} onChange={setSettings} onSubmit={submitSettings} />}

    <section className={styles.summary} aria-label="Résumé de la situation pilote">
      {summary.map(([label, result]) => <article className={styles.summaryCard} key={label}><span>{label}</span><strong data-status={result.status}>{pilotStatusLabel(result.status, label === "Médical")}</strong></article>)}
    </section>

    <section className={`${styles.section} ${styles.todo}`} aria-labelledby="todo-title"><h2 id="todo-title">À faire</h2>{actionItems.length ? <ul>{actionItems.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Votre dossier est à jour.</p>}</section>

    <section className={styles.section} aria-labelledby="bpl-title"><div className={styles.sectionHeader}><h2 id="bpl-title">Maintien BPL</h2><StatusBadge status={view.bpl.overall.status} /></div>
      <CompactRequirement title="Expérience récente — 24 mois" result={view.bpl.recentExperience}><p>{Math.floor(experience.officialDurationMinutes / 60)} h {experience.officialDurationMinutes % 60} / 6 h · {experience.takeoffs} / 10 décollages · {experience.landings} / 10 atterrissages</p></CompactRequirement>
      <CompactRequirement title="Vol d’entraînement" result={view.bpl.trainingFlightFiB}><p>{typeof view.bpl.trainingFlightFiB.currentValue === "string" ? `Dernier vol : ${formatQualificationDate(view.bpl.trainingFlightFiB.currentValue)} · échéance ${formatQualificationDate(view.bpl.trainingFlightFiB.dueDate)}` : "Aucun vol d’entraînement enregistré"}</p></CompactRequirement>
      <CompactRequirement title="Contrôle de compétences" result={view.bpl.proficiencyCheckFeB}><p>{typeof view.bpl.proficiencyCheckFeB.currentValue === "string" ? `Dernier contrôle : ${formatQualificationDate(view.bpl.proficiencyCheckFeB.currentValue)} · échéance ${formatQualificationDate(view.bpl.proficiencyCheckFeB.dueDate)}` : "Aucun contrôle enregistré"}</p></CompactRequirement>
    </section>

    <section className={styles.section} aria-labelledby="medical-title"><div className={styles.sectionHeader}><h2 id="medical-title">Médical</h2><StatusBadge status={view.medical.overall.status} /></div>
      <p className={styles.compactText}>{medicalEvent?.medicalClass ? `Classe ${medicalEvent.medicalClass} · échéance ${formatQualificationDate(view.medical.expiry.dueDate)}` : "Classe médicale à renseigner dans l’historique"}</p>
      {!medicalEvent?.medicalClass && qualifications.legacy.medicalDueDateIso && <p className={styles.legacyHint}>Échéance antérieure conservée ; classe médicale à renseigner.</p>}
    </section>

    {qualifications.profile.commercialOperationsEnabled && <section className={styles.section} aria-labelledby="commercial-title"><div className={styles.sectionHeader}><h2 id="commercial-title">Activité professionnelle</h2><StatusBadge status={commercialSummary.status} /></div>
      {view.commercial.length === 0 ? <p className={styles.compactText}>Classe ballon à renseigner dans l’historique.</p> : view.commercial.map((commercial) => <article className={styles.commercialClass} key={`${commercial.balloonClass.classId}:${commercial.balloonClass.groupId ?? ""}`}><h3>{qualificationClassLabel(commercial.balloonClass.classId)}{commercial.balloonClass.groupId ? ` · ${commercial.balloonClass.groupId}` : ""}</h3>
        <CompactRequirement title="Récence — 180 jours" result={commercial.recency} />
        <CompactRequirement title="Contrôle de compétences" result={commercial.proficiencyCheckFeB} />
        <CompactRequirement title="Formation / remise à niveau" result={commercial.refresherCourse} />
      </article>)}
      <CompactRequirement title="Premiers secours / PSC1" result={firstAid}><p>{firstAid.dueDate ? `Échéance ${formatQualificationDate(firstAid.dueDate)}` : "Formation non renseignée"}</p></CompactRequirement>
      <CompactRequirement title="Formation incendie" result={fire}><p>{fire.dueDate ? `Échéance ${formatQualificationDate(fire.dueDate)}` : "Formation non renseignée"}</p></CompactRequirement>
      {otherEvents.map((event) => <p className={styles.compactText} key={event.id}>{event.organization || "Autre formation"} · {formatQualificationDate(event.dateIso)}</p>)}
    </section>}

    <section className={styles.section} aria-labelledby="history-title"><h2 id="history-title">Historique</h2><div className={styles.history}>{history.length ? history.map((event) => <article className={styles.historyItem} key={event.id}><h3>{qualificationEventLabel(event.type)}</h3><div className={styles.historyMeta}><span>{formatQualificationDate(event.dateIso)}</span>{event.expiryDateIso && <span>Échéance : {formatQualificationDate(event.expiryDateIso)}</span>}{event.instructor && <span>FI(B) : {event.instructor.name}</span>}{event.examiner && <span>FE(B) : {event.examiner.name}</span>}</div>{event.officialAscensionId && (event.officialAscensionDeletedAt ? <p className={styles.deleted}>Ascension liée supprimée — preuve réglementaire conservée</p> : <Link className={styles.historyLink} href={`/journal/ascension/${encodeURIComponent(event.officialAscensionId)}`}>Voir l’ascension liée →</Link>)}</article>) : <p className={styles.empty}>Aucun événement de qualification enregistré.</p>}</div></section>

    <button className={styles.editBottom} type="button" onClick={() => { setSettings(qualifications.profile); setEditing(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Modifier ma situation</button>
  </div><NavigationBar activeItem="Plus" /></main>;
}
