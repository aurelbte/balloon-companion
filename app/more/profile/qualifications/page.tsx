"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import NavigationBar from "../../../components/NavigationBar";
import { useFlightCompletionState } from "../../../hooks/useFlightCompletionState";
import { calculateBplMaintenance, type QualificationRequirementResult, type QualificationRequirementStatus } from "../../../lib/bplQualificationEngine";
import { emptyBplEventDraft, linkBplEventToAscension, updateLinkedBplEventProof, upsertHistoricalBplEvent, type BplEventDraft, type EditableBplEventType } from "../../../lib/bplQualificationEventForm";
import { calculateCommercialQualification, OFFICIAL_ASCENSION_CLASS_IDS } from "../../../lib/commercialQualificationEngine";
import { calculateMedicalQualification, calculateProfessionalTrainingStatus } from "../../../lib/medicalTrainingQualificationEngine";
import { emptyQualificationEventDraft, upsertQualificationEvent, type EditableQualificationEventType, type QualificationEventDraft } from "../../../lib/qualificationEventForm";
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

function medicalClassLabel(value: string): string {
  if (value === "CLASS_2") return "Classe 2";
  if (value === "OTHER") return "Autre";
  return value;
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

const EDITOR_LABELS: Record<EditableQualificationEventType, string> = {
  MEDICAL: "Médical",
  FIRST_AID: "Premiers secours / PSC1",
  FIRE_TRAINING: "Formation incendie",
};

function QualificationEventForm({ type, draft, error, editing, onChange, onCancel, onSubmit }: {
  type: EditableQualificationEventType;
  draft: QualificationEventDraft;
  error: string;
  editing: boolean;
  onChange: (draft: QualificationEventDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const medical = type === "MEDICAL";
  return <form className={styles.eventForm} onSubmit={onSubmit}>
    <div className={styles.eventFormHeader}><h2>{editing ? "Modifier" : "Ajouter"} — {EDITOR_LABELS[type]}</h2><button type="button" onClick={onCancel}>Fermer</button></div>
    {medical && <label><span>Type / classe</span><select required value={draft.medicalClass} onChange={(event) => onChange({ ...draft, medicalClass: event.target.value })}><option value="">Choisir</option><option value="LAPL">LAPL</option><option value="CLASS_2">Classe 2</option><option value="OTHER">Autre</option></select></label>}
    <label><span>{medical ? "Date de visite / délivrance" : "Date de formation"}</span><input required type="date" value={draft.dateIso} onChange={(event) => onChange({ ...draft, dateIso: event.target.value })} /></label>
    <label><span>Date d’échéance{!medical && " (facultative)"}</span><input required={medical} type="date" min={draft.dateIso || undefined} value={draft.expiryDateIso} onChange={(event) => onChange({ ...draft, expiryDateIso: event.target.value })} /></label>
    {!medical && <label><span>Organisme (facultatif)</span><input value={draft.organization} onChange={(event) => onChange({ ...draft, organization: event.target.value })} /></label>}
    <label className={styles.eventFormWide}><span>Notes (facultatif)</span><textarea value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label>
    {error && <p className={styles.formError} role="alert">{error}</p>}
    <button className={`${styles.save} ${styles.eventFormWide}`} type="submit">Enregistrer</button>
  </form>;
}

function BplEventForm({ type, mode, draft, ascensionId, ascensions, linkedEditing, error, onModeChange, onDraftChange, onAscensionChange, onCancel, onSubmit }: {
  type: EditableBplEventType;
  mode: "LINKED" | "HISTORICAL";
  draft: BplEventDraft;
  ascensionId: string;
  ascensions: PilotQualificationsPageState["completion"]["officialAscensions"];
  linkedEditing: boolean;
  error: string;
  onModeChange: (mode: "LINKED" | "HISTORICAL") => void;
  onDraftChange: (draft: BplEventDraft) => void;
  onAscensionChange: (id: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const training = type === "TRAINING_FLIGHT_BPL";
  return <form className={styles.eventForm} onSubmit={onSubmit}>
    <div className={styles.eventFormHeader}><h2>{training ? "Vol d’entraînement BPL" : "Contrôle de compétences BPL"}</h2><button type="button" onClick={onCancel}>Fermer</button></div>
    {!linkedEditing && <fieldset className={`${styles.originChoice} ${styles.eventFormWide}`}><legend>Origine</legend><label><input type="radio" name="bpl-origin" checked={mode === "LINKED"} onChange={() => onModeChange("LINKED")} /> Associer un vol du carnet</label><label><input type="radio" name="bpl-origin" checked={mode === "HISTORICAL"} onChange={() => onModeChange("HISTORICAL")} /> {training ? "Ajouter un vol historique" : "Ajouter un contrôle historique"}</label></fieldset>}
    {mode === "LINKED" ? <label className={styles.eventFormWide}><span>Ascension du carnet</span><select required disabled={linkedEditing} value={ascensionId} onChange={(event) => onAscensionChange(event.target.value)}><option value="">Choisir une ascension</option>{ascensions.map((ascension) => <option key={ascension.id} value={ascension.id}>{formatQualificationDate(ascension.dateIso)} · {ascension.registration} · {ascension.departure} → {ascension.arrival}</option>)}</select></label> : <label><span>{training ? "Date du vol" : "Date du contrôle"}</span><input required type="date" value={draft.dateIso} onChange={(event) => onDraftChange({ ...draft, dateIso: event.target.value })} /></label>}
    <label className={mode === "LINKED" ? styles.eventFormWide : undefined}><span>{training ? "Instructeur FI(B)" : "Examinateur FE(B)"}</span><input required value={draft.personName} onChange={(event) => onDraftChange({ ...draft, personName: event.target.value })} /></label>
    <label className={styles.eventFormWide}><span>Notes (facultatif)</span><textarea value={draft.notes} onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })} /></label>
    {error && <p className={styles.formError} role="alert">{error}</p>}
    <button className={`${styles.save} ${styles.eventFormWide}`} type="submit">Enregistrer</button>
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
  const [eventEditor, setEventEditor] = useState<EditableQualificationEventType | null>(null);
  const [eventDraft, setEventDraft] = useState<QualificationEventDraft>(() => emptyQualificationEventDraft());
  const [eventError, setEventError] = useState("");
  const [editedEventId, setEditedEventId] = useState<string | undefined>();
  const [bplEditor, setBplEditor] = useState<EditableBplEventType | null>(null);
  const [bplMode, setBplMode] = useState<"LINKED" | "HISTORICAL">("LINKED");
  const [bplDraft, setBplDraft] = useState<BplEventDraft>(() => emptyBplEventDraft());
  const [bplAscensionId, setBplAscensionId] = useState("");
  const [bplEditedEventId, setBplEditedEventId] = useState<string | undefined>();
  const [bplError, setBplError] = useState("");
  const lastSubmittedProfile = useRef<string | null>(null);
  const eventEditorAnchor = useRef<HTMLDivElement | null>(null);
  const referenceDateIso = localIsoDate();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadPilotQualifications(window.localStorage);
      setQualifications(loaded);
      setSettings(loaded.profile);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!eventEditor && !bplEditor) return;
    const frame = window.requestAnimationFrame(() => eventEditorAnchor.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [eventEditor, bplEditor]);

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

  const latestEvent = (type: EditableQualificationEventType) => [...qualifications.events]
    .filter((event) => event.type === type)
    .sort((left, right) => right.dateIso.localeCompare(left.dateIso) || right.updatedAt.localeCompare(left.updatedAt))[0];

  const openEventEditor = (type: EditableQualificationEventType) => {
    const existing = latestEvent(type);
    setEventEditor(type);
    setEditedEventId(existing?.id);
    setEventDraft(emptyQualificationEventDraft(existing));
    setEventError("");
    setBplEditor(null);
  };

  const openBplEditor = (type: EditableBplEventType, existing?: QualificationEvent) => {
    const linked = Boolean(existing?.officialAscensionId);
    setBplEditor(type);
    setBplEditedEventId(existing?.id);
    setBplMode(linked ? "LINKED" : existing ? "HISTORICAL" : "LINKED");
    setBplAscensionId(existing?.officialAscensionId ?? "");
    setBplDraft(emptyBplEventDraft(existing));
    setBplError("");
    setEventEditor(null);
  };

  const submitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!eventEditor) return;
    const result = upsertQualificationEvent(qualifications.events, eventEditor, eventDraft, editedEventId);
    if (!result.ok) { setEventError(result.error); return; }
    const next = { ...qualifications, events: result.events };
    if (!savePilotQualifications({ profile: qualifications.profile, events: result.events }, window.localStorage)) {
      setEventError("Enregistrement local impossible.");
      return;
    }
    setQualifications(next);
    setEventEditor(null);
    setEventError("");
  };

  const submitBplEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!bplEditor) return;
    const result = bplMode === "LINKED"
      ? bplEditedEventId
        ? updateLinkedBplEventProof(qualifications.events, bplEditor, bplDraft, bplEditedEventId)
        : linkBplEventToAscension(qualifications.events, bplEditor, completion.officialAscensions.find(({ id }) => id === bplAscensionId), bplDraft)
      : upsertHistoricalBplEvent(qualifications.events, bplEditor, bplDraft, bplEditedEventId);
    if (!result.ok) { setBplError(result.error); return; }
    if (!savePilotQualifications({ profile: qualifications.profile, events: result.events }, window.localStorage)) { setBplError("Enregistrement local impossible."); return; }
    setQualifications({ ...qualifications, events: result.events });
    setBplEditor(null);
    setBplError("");
  };

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
  const medicalEvent = latestEvent("MEDICAL");
  const firstAidEvent = latestEvent("FIRST_AID");
  const fireEvent = latestEvent("FIRE_TRAINING");
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
  const actionItems: Array<Readonly<{ text: string; editor?: EditableQualificationEventType; bplType?: EditableBplEventType; buttonLabel?: string }>> = [
    ...(["UNKNOWN", "ACTION_REQUIRED"].includes(view.medical.overall.status) ? [{ text: medicalEvent ? "Mettre à jour votre médical" : "Renseigner votre classe médicale", editor: "MEDICAL" as const, buttonLabel: medicalEvent ? "Modifier" : "Renseigner" }] : []),
    ...(view.bpl.trainingFlightFiB.status === "UNKNOWN" ? [{ text: "Enregistrer votre dernier vol d’entraînement", bplType: "TRAINING_FLIGHT_BPL" as const, buttonLabel: "Ajouter" }] : []),
    ...(view.bpl.proficiencyCheckFeB.status === "UNKNOWN" ? [{ text: "Enregistrer votre dernier contrôle de compétences", bplType: "PROFICIENCY_CHECK_BPL" as const, buttonLabel: "Ajouter" }] : []),
    ...(qualifications.profile.commercialOperationsEnabled && ["UNKNOWN", "ACTION_REQUIRED"].includes(firstAid.status) ? [{ text: firstAidEvent ? "Compléter ou renouveler votre PSC1" : "Renseigner votre formation PSC1", editor: "FIRST_AID" as const, buttonLabel: firstAidEvent ? "Modifier" : "Ajouter" }] : []),
    ...(qualifications.profile.commercialOperationsEnabled && ["UNKNOWN", "ACTION_REQUIRED"].includes(fire.status) ? [{ text: fireEvent ? "Compléter ou renouveler votre formation incendie" : "Renseigner votre formation incendie", editor: "FIRE_TRAINING" as const, buttonLabel: fireEvent ? "Modifier" : "Ajouter" }] : []),
  ];

  return <main className={moreStyles.screen}><div className={moreStyles.layout}>
    <Link href="/more/profile" className={moreStyles.back}><ChevronLeft size={18} aria-hidden="true" /> Profil pilote</Link>
    <header className={styles.header}><div><p className={moreStyles.eyebrow}>Profil pilote</p><h1 className={moreStyles.title}>Qualifications &amp; validité</h1></div><button className={styles.edit} type="button" onClick={() => setEditing((value) => !value)}>Modifier ma situation</button></header>

    {editing && <QualificationSettingsForm settings={settings} onChange={setSettings} onSubmit={submitSettings} />}

    <section className={styles.summary} aria-label="Résumé de la situation pilote">
      {summary.map(([label, result]) => <article className={styles.summaryCard} key={label}><span>{label}</span><strong data-status={result.status}>{pilotStatusLabel(result.status, label === "Médical")}</strong></article>)}
    </section>

    <section className={`${styles.section} ${styles.todo}`} aria-labelledby="todo-title"><h2 id="todo-title">À faire</h2>{actionItems.length ? <ul>{actionItems.map((item) => <li key={item.text}><span>{item.text}</span>{item.editor && <button type="button" onClick={() => openEventEditor(item.editor!)}>{item.buttonLabel}</button>}{item.bplType && <button type="button" onClick={() => openBplEditor(item.bplType!)}>{item.buttonLabel}</button>}</li>)}</ul> : <p>Votre dossier est à jour.</p>}</section>

    <section className={styles.section} aria-labelledby="bpl-title"><div className={styles.sectionHeader}><h2 id="bpl-title">Maintien BPL</h2><StatusBadge status={view.bpl.overall.status} /></div>
      <CompactRequirement title="Expérience récente — 24 mois" result={view.bpl.recentExperience}><p>{Math.floor(experience.officialDurationMinutes / 60)} h {experience.officialDurationMinutes % 60} / 6 h · {experience.takeoffs} / 10 décollages · {experience.landings} / 10 atterrissages</p></CompactRequirement>
      <CompactRequirement title="Vol d’entraînement" result={view.bpl.trainingFlightFiB}><p>{typeof view.bpl.trainingFlightFiB.currentValue === "string" ? `Dernier vol : ${formatQualificationDate(view.bpl.trainingFlightFiB.currentValue)} · échéance ${formatQualificationDate(view.bpl.trainingFlightFiB.dueDate)}` : "Aucun vol d’entraînement enregistré"}</p></CompactRequirement>
      <CompactRequirement title="Contrôle de compétences" result={view.bpl.proficiencyCheckFeB}><p>{typeof view.bpl.proficiencyCheckFeB.currentValue === "string" ? `Dernier contrôle : ${formatQualificationDate(view.bpl.proficiencyCheckFeB.currentValue)} · échéance ${formatQualificationDate(view.bpl.proficiencyCheckFeB.dueDate)}` : "Aucun contrôle enregistré"}</p></CompactRequirement>
      {bplEditor && <div ref={eventEditorAnchor}><BplEventForm type={bplEditor} mode={bplMode} draft={bplDraft} ascensionId={bplAscensionId} ascensions={[...completion.officialAscensions].filter((ascension) => ascension.flightNature === (bplEditor === "TRAINING_FLIGHT_BPL" ? "TRAINING_BPL" : "PROFICIENCY_CHECK_BPL")).sort((left, right) => right.dateIso.localeCompare(left.dateIso))} linkedEditing={Boolean(bplEditedEventId && bplMode === "LINKED")} error={bplError} onModeChange={setBplMode} onDraftChange={setBplDraft} onAscensionChange={setBplAscensionId} onCancel={() => setBplEditor(null)} onSubmit={submitBplEvent} /></div>}
    </section>

    <section className={styles.section} aria-labelledby="medical-title"><div className={styles.sectionHeader}><h2 id="medical-title">Médical</h2><StatusBadge status={view.medical.overall.status} /></div>
      <p className={styles.compactText}>{medicalEvent?.medicalClass ? `${medicalClassLabel(medicalEvent.medicalClass)} · échéance ${formatQualificationDate(view.medical.expiry.dueDate)}` : "Classe médicale à renseigner dans l’historique"}</p>
      {!medicalEvent?.medicalClass && qualifications.legacy.medicalDueDateIso && <p className={styles.legacyHint}>Échéance antérieure conservée ; classe médicale à renseigner.</p>}
      <button className={styles.inlineAction} type="button" onClick={() => openEventEditor("MEDICAL")}>{medicalEvent ? "Modifier" : "Renseigner"}</button>
      {eventEditor === "MEDICAL" && <div ref={eventEditorAnchor}><QualificationEventForm type={eventEditor} draft={eventDraft} error={eventError} editing={Boolean(editedEventId)} onChange={setEventDraft} onCancel={() => setEventEditor(null)} onSubmit={submitEvent} /></div>}
    </section>

    {qualifications.profile.commercialOperationsEnabled && <section className={styles.section} aria-labelledby="commercial-title"><div className={styles.sectionHeader}><h2 id="commercial-title">Activité professionnelle</h2><StatusBadge status={commercialSummary.status} /></div>
      {view.commercial.length === 0 ? <p className={styles.compactText}>Classe ballon à renseigner dans l’historique.</p> : view.commercial.map((commercial) => <article className={styles.commercialClass} key={`${commercial.balloonClass.classId}:${commercial.balloonClass.groupId ?? ""}`}><h3>{qualificationClassLabel(commercial.balloonClass.classId)}{commercial.balloonClass.groupId ? ` · ${commercial.balloonClass.groupId}` : ""}</h3>
        <CompactRequirement title="Récence — 180 jours" result={commercial.recency} />
        <CompactRequirement title="Contrôle de compétences" result={commercial.proficiencyCheckFeB} />
        <CompactRequirement title="Formation / remise à niveau" result={commercial.refresherCourse} />
      </article>)}
      <CompactRequirement title="Premiers secours / PSC1" result={firstAid}><p>{firstAidEvent ? `${formatQualificationDate(firstAidEvent.dateIso)}${firstAidEvent.expiryDateIso ? ` · échéance ${formatQualificationDate(firstAidEvent.expiryDateIso)}` : " · sans échéance renseignée"}` : "Formation non renseignée"}</p><button className={styles.inlineAction} type="button" onClick={() => openEventEditor("FIRST_AID")}>{firstAidEvent ? "Modifier" : "Ajouter"}</button></CompactRequirement>
      <CompactRequirement title="Formation incendie" result={fire}><p>{fireEvent ? `${formatQualificationDate(fireEvent.dateIso)}${fireEvent.expiryDateIso ? ` · échéance ${formatQualificationDate(fireEvent.expiryDateIso)}` : " · sans échéance renseignée"}` : "Formation non renseignée"}</p><button className={styles.inlineAction} type="button" onClick={() => openEventEditor("FIRE_TRAINING")}>{fireEvent ? "Modifier" : "Ajouter"}</button></CompactRequirement>
      {(eventEditor === "FIRST_AID" || eventEditor === "FIRE_TRAINING") && <div ref={eventEditorAnchor}><QualificationEventForm type={eventEditor} draft={eventDraft} error={eventError} editing={Boolean(editedEventId)} onChange={setEventDraft} onCancel={() => setEventEditor(null)} onSubmit={submitEvent} /></div>}
      {otherEvents.map((event) => <p className={styles.compactText} key={event.id}>{event.organization || "Autre formation"} · {formatQualificationDate(event.dateIso)}</p>)}
    </section>}

    <section className={styles.section} aria-labelledby="history-title"><h2 id="history-title">Historique</h2><div className={styles.history}>{history.length ? history.map((event) => <article className={styles.historyItem} key={event.id}><h3>{qualificationEventLabel(event.type)}</h3><div className={styles.historyMeta}><span>{formatQualificationDate(event.dateIso)}</span>{event.expiryDateIso && <span>Échéance : {formatQualificationDate(event.expiryDateIso)}</span>}{event.organization && <span>Organisme : {event.organization}</span>}{event.instructor && <span>FI(B) : {event.instructor.name}</span>}{event.examiner && <span>FE(B) : {event.examiner.name}</span>}</div>{(event.type === "TRAINING_FLIGHT_BPL" || event.type === "PROFICIENCY_CHECK_BPL") && <><p className={styles.linkKind}>{event.officialAscensionId ? "Lié au carnet" : "Historique — non lié au carnet"}</p><button className={styles.inlineAction} type="button" onClick={() => openBplEditor(event.type as EditableBplEventType, event)}>Modifier</button></>}{event.officialAscensionId && (event.officialAscensionDeletedAt ? <p className={styles.deleted}>Ascension liée supprimée — preuve réglementaire conservée</p> : <Link className={styles.historyLink} href={`/journal/ascension/${encodeURIComponent(event.officialAscensionId)}`}>Voir l’ascension liée →</Link>)}</article>) : <p className={styles.empty}>Aucun événement de qualification enregistré.</p>}</div></section>

    <button className={styles.editBottom} type="button" onClick={() => { setSettings(qualifications.profile); setEditing(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Modifier ma situation</button>
  </div><NavigationBar activeItem="Plus" /></main>;
}
