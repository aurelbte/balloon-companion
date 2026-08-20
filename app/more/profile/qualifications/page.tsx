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

function Requirement({ title, result, children }: { title: string; result: QualificationRequirementResult; children?: ReactNode }) {
  return <article className={styles.requirement}><div className={styles.requirementTitle}><h3>{title}</h3><StatusBadge status={result.status} /></div>{children}<p className={styles.reason}>{result.reason}</p></article>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className={styles.fact}><span>{label}</span><strong>{value}</strong></div>;
}

function QualificationSettingsForm({ priority = false, settings, onChange, onSubmit }: {
  priority?: boolean;
  settings: QualificationProfile;
  onChange: (settings: QualificationProfile) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form className={`${styles.settings} ${priority ? styles.prioritySettings : ""}`} onSubmit={onSubmit}>
    <h2>{priority ? "Configurer votre profil" : "Réglages"}</h2>
    {priority && <p className={styles.priorityText}>Configurez votre profil pour calculer vos qualifications et validités.</p>}
    <div className={styles.settingsGrid}>
      <label htmlFor="qualification-licence-type"><span>Type de licence</span><select id="qualification-licence-type" value={settings.licenceType ?? ""} onChange={(event) => onChange({ ...settings, licenceType: event.target.value || null })}><option value="">Non renseigné</option><option value="BPL">BPL</option><option value="OTHER">Autre</option></select></label>
      <label className={styles.toggle} htmlFor="qualification-commercial"><input id="qualification-commercial" type="checkbox" checked={settings.commercialOperationsEnabled} onChange={(event) => onChange({ ...settings, commercialOperationsEnabled: event.target.checked })} /><span>Activité commerciale</span></label>
      <label className={styles.toggle} htmlFor="qualification-fi-b"><input id="qualification-fi-b" type="checkbox" checked={settings.fiBEnabled} onChange={(event) => onChange({ ...settings, fiBEnabled: event.target.checked })} /><span>Qualification FI(B)</span></label>
      <label className={styles.toggle} htmlFor="qualification-fe-b"><input id="qualification-fe-b" type="checkbox" checked={settings.feBEnabled} onChange={(event) => onChange({ ...settings, feBEnabled: event.target.checked })} /><span>Qualification FE(B)</span></label>
    </div>
    <button className={styles.save} type="submit">{priority ? "Enregistrer" : "Enregistrer les réglages"}</button>
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
    ...(qualifications.profile.commercialOperationsEnabled ? [["Commercial", commercialSummary] as const] : []),
  ];

  return <main className={moreStyles.screen}><div className={moreStyles.layout}>
    <Link href="/more/profile" className={moreStyles.back}><ChevronLeft size={18} aria-hidden="true" /> Profil pilote</Link>
    <header><p className={moreStyles.eyebrow}>Profil pilote</p><h1 className={moreStyles.title}>Qualifications &amp; validité</h1><p className={moreStyles.subtitle}>Situation calculée depuis votre carnet officiel et votre historique local.</p></header>

    <section className={styles.summary} aria-label="Résumé de la situation pilote">
      {summary.map(([label, result]) => <article className={styles.summaryCard} key={label}><span>{label}</span><strong><StatusBadge status={result.status} /></strong><p className={styles.reason}>{result.reason}</p></article>)}
    </section>

    <section className={styles.section} aria-labelledby="bpl-title"><div className={styles.sectionHeader}><h2 id="bpl-title">BPL</h2><StatusBadge status={view.bpl.overall.status} /></div><p className={styles.sectionIntro}>{view.bpl.overall.reason}</p>
      <Requirement title="Expérience récente — 24 mois" result={view.bpl.recentExperience}><div className={styles.facts}><Fact label="Heures" value={`${Math.floor(experience.officialDurationMinutes / 60)} h ${experience.officialDurationMinutes % 60} / 6 h`} /><Fact label="Décollages" value={`${experience.takeoffs} / 10`} /><Fact label="Atterrissages" value={`${experience.landings} / 10`} /><Fact label="Ascensions datées" value={experience.ascensions} /></div></Requirement>
      <Requirement title="Dernier vol d’entraînement BPL" result={view.bpl.trainingFlightFiB}><div className={styles.facts}><Fact label="Dernier vol" value={typeof view.bpl.trainingFlightFiB.currentValue === "string" ? formatQualificationDate(view.bpl.trainingFlightFiB.currentValue) : "Non renseigné"} /><Fact label="Échéance 48 mois" value={formatQualificationDate(view.bpl.trainingFlightFiB.dueDate)} /></div></Requirement>
      <Requirement title="Contrôle de compétences BPL" result={view.bpl.proficiencyCheckFeB}><div className={styles.facts}><Fact label="Dernier contrôle" value={typeof view.bpl.proficiencyCheckFeB.currentValue === "string" ? formatQualificationDate(view.bpl.proficiencyCheckFeB.currentValue) : "Non renseigné"} /><Fact label="Échéance" value={formatQualificationDate(view.bpl.proficiencyCheckFeB.dueDate)} /></div></Requirement>
    </section>

    <section className={styles.section} aria-labelledby="medical-title"><div className={styles.sectionHeader}><h2 id="medical-title">Médical</h2><StatusBadge status={view.medical.overall.status} /></div>
      <div className={styles.facts}><Fact label="Classe connue" value={medicalEvent?.medicalClass ?? "Inconnue"} /><Fact label="Échéance" value={formatQualificationDate(view.medical.expiry.dueDate)} /></div><p className={styles.reason}>{view.medical.overall.reason}</p>
      {!medicalEvent?.medicalClass && qualifications.legacy.medicalDueDateIso && <p className={styles.sectionIntro}>Échéance issue de l’ancien profil : la classe médicale n’est pas connue et reste donc non déterminée.</p>}
    </section>

    {qualifications.profile.commercialOperationsEnabled && <section className={styles.section} aria-labelledby="commercial-title"><div className={styles.sectionHeader}><h2 id="commercial-title">Activité commerciale</h2></div>
      {view.commercial.length === 0 ? <p className={styles.empty}>Données insuffisantes : aucune classe ballon concernée n’est connue.</p> : view.commercial.map((commercial) => <article className={styles.commercialClass} key={`${commercial.balloonClass.classId}:${commercial.balloonClass.groupId ?? ""}`}><h3>{qualificationClassLabel(commercial.balloonClass.classId)}{commercial.balloonClass.groupId ? ` · ${commercial.balloonClass.groupId}` : ""}</h3>
        <Requirement title="Récence — 180 jours" result={commercial.recency}><div className={styles.facts}><Fact label="Vols PIC acquis" value={String((commercial.recency.currentValue as { picFlights?: number } | undefined)?.picFlights ?? 0)} /><Fact label="Classe concernée" value={qualificationClassLabel(commercial.balloonClass.classId)} /></div></Requirement>
        <Requirement title="Contrôle de compétences commercial" result={commercial.proficiencyCheckFeB}><div className={styles.facts}><Fact label="Échéance" value={formatQualificationDate(commercial.proficiencyCheckFeB.dueDate)} /></div></Requirement>
        <Requirement title="Cours de remise à niveau commercial" result={commercial.refresherCourse}><div className={styles.facts}><Fact label="Échéance" value={formatQualificationDate(commercial.refresherCourse.dueDate)} /></div></Requirement>
      </article>)}
      <article className={styles.requirement}><div className={styles.requirementTitle}><h3>Crédits appliqués au BPL</h3></div>{view.credits.length ? <ul className={styles.reason}>{view.credits.map((credit) => <li key={`${credit.creditedFrom}:${credit.sourceEventIds.join(":")}`}>{credit.creditedFrom === "COMMERCIAL_PROFICIENCY_CHECK" ? "Contrôle de compétences commercial" : "Cours de remise à niveau commercial"} → {credit.requirement === "PROFICIENCY_CHECK" ? "contrôle BPL" : "vol d’entraînement BPL"}</li>)}</ul> : <p className={styles.reason}>Aucun crédit commercial appliqué au BPL.</p>}</article>
    </section>}

    {qualifications.profile.commercialOperationsEnabled && <section className={styles.section} aria-labelledby="training-title"><h2 id="training-title">Formations professionnelles</h2>
      <Requirement title="Premiers secours / PSC1" result={firstAid}><div className={styles.facts}><Fact label="Échéance" value={formatQualificationDate(firstAid.dueDate)} /></div></Requirement>
      <Requirement title="Formation incendie" result={fire}><div className={styles.facts}><Fact label="Échéance" value={formatQualificationDate(fire.dueDate)} /></div></Requirement>
      {otherEvents.length ? otherEvents.map((event) => { const result = calculateProfessionalTrainingStatus({ profile: qualifications.profile, events: [event], type: "OTHER_TRAINING", referenceDateIso }); return <Requirement key={event.id} title={event.organization || "Autre formation professionnelle"} result={result}><div className={styles.facts}><Fact label="Date" value={formatQualificationDate(event.dateIso)} /><Fact label="Échéance" value={formatQualificationDate(event.expiryDateIso)} /></div></Requirement>; }) : <p className={styles.empty}>Aucune autre formation professionnelle enregistrée.</p>}
    </section>}

    <section className={styles.section} aria-labelledby="history-title"><h2 id="history-title">Historique</h2><div className={styles.history}>{history.length ? history.map((event) => <article className={styles.historyItem} key={event.id}><h3>{qualificationEventLabel(event.type)}</h3><div className={styles.historyMeta}><span>{formatQualificationDate(event.dateIso)}</span>{event.expiryDateIso && <span>Échéance : {formatQualificationDate(event.expiryDateIso)}</span>}{event.instructor && <span>FI(B) : {event.instructor.name}</span>}{event.examiner && <span>FE(B) : {event.examiner.name}</span>}</div>{event.officialAscensionId && (event.officialAscensionDeletedAt ? <p className={styles.deleted}>Ascension liée supprimée — preuve réglementaire conservée</p> : <Link className={styles.historyLink} href={`/journal/ascension/${encodeURIComponent(event.officialAscensionId)}`}>Voir l’ascension liée →</Link>)}</article>) : <p className={styles.empty}>Aucun événement de qualification enregistré.</p>}</div></section>

    <QualificationSettingsForm settings={settings} onChange={setSettings} onSubmit={submitSettings} />
  </div><NavigationBar activeItem="Plus" /></main>;
}
