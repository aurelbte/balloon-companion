"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import NavigationBar from "../../../components/NavigationBar";
import { useFlightCompletionState } from "../../../hooks/useFlightCompletionState";
import { calculateBplPrivilegesMaintenance, type QualificationRequirementResult, type QualificationRequirementStatus } from "../../../lib/bplQualificationEngine";
import { emptyBplEventDraft, linkBplEventToAscension, updateLinkedBplEventProof, upsertHistoricalBplEvent, upsertInitialBplIssuance, type BplEventDraft, type EditableBplEventType } from "../../../lib/bplQualificationEventForm";
import { calculateCommercialQualification, OFFICIAL_ASCENSION_CLASS_IDS } from "../../../lib/commercialQualificationEngine";
import { emptyCommercialEventDraft, upsertCommercialQualificationEvent, type CommercialEventDraft, type EditableCommercialEventType } from "../../../lib/commercialQualificationEventForm";
import { calculateMedicalQualification, calculateProfessionalTrainingStatus } from "../../../lib/medicalTrainingQualificationEngine";
import { evaluateFiBRecency } from "../../../lib/fiBQualificationEngine";
import { emptyFiBEventDraft, upsertFiBQualificationEvent, type EditableFiBEventType, type FiBEventDraft } from "../../../lib/fiBQualificationEventForm";
import { emptyQualificationEventDraft, removeQualificationEvent, upsertQualificationEvent, type EditableQualificationEventType, type QualificationEventDraft } from "../../../lib/qualificationEventForm";
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
  return <article className={styles.compactRequirement}><div><h3>{title}</h3>{result.provenance === "DECLARED_BY_PILOT" && <p className={styles.declared}>Déclaré par le pilote</p>}{children}<details><summary>Détails</summary><p>{result.reason}</p>{result.declarationReferenceDateIso && <p>Date de référence : {formatQualificationDate(result.declarationReferenceDateIso)}. Le calcul automatique prendra le relais dès que la fenêtre sera entièrement couverte.</p>}</details></div><StatusBadge status={result.status} /></article>;
}

function InitialSituationForm({ profile, onChange, onCancel, onSubmit, onDeleteBpl, onDeleteCommercial }: {
  profile: QualificationProfile;
  onChange: (profile: QualificationProfile) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteBpl: () => void;
  onDeleteCommercial: (classId: string) => void;
}) {
  const setCommercial = (classId: string, field: "referenceDateIso" | "recencySatisfied", value: string | boolean | null) => {
    const existing = profile.declaredCommercialInitialSituations.find((item) => item.balloonClass.classId === classId);
    const next = { balloonClass: { classId }, referenceDateIso: existing?.referenceDateIso ?? null, recencySatisfied: existing?.recencySatisfied ?? null, [field]: value };
    onChange({ ...profile, declaredCommercialInitialSituations: [...profile.declaredCommercialInitialSituations.filter((item) => item.balloonClass.classId !== classId), next] });
  };
  const answer = (value: boolean | null) => value === null ? "" : String(value);
  return <form className={styles.eventForm} onSubmit={onSubmit}><div className={styles.eventFormHeader}><h2>Renseigner ma situation initiale</h2><button type="button" onClick={onCancel}>Fermer</button></div>
    <p className={`${styles.compactText} ${styles.eventFormWide}`}>Si votre historique Balloon Companion est incomplet, vous pouvez déclarer votre situation à une date de référence. Cette déclaration sera utilisée temporairement jusqu’à ce que la fenêtre réglementaire soit entièrement couverte.</p>
    <div className={styles.declarationClass}><h3>BPL</h3><label><span>Date de référence</span><input type="date" value={profile.declaredBplInitialSituation.referenceDateIso ?? ""} onChange={(event) => onChange({ ...profile, declaredBplInitialSituation: { ...profile.declaredBplInitialSituation, referenceDateIso: event.target.value || null } })} /></label>
    <label><span>Les conditions d’expérience récente BPL étaient-elles satisfaites ?</span><select value={answer(profile.declaredBplInitialSituation.recentExperienceSatisfied)} onChange={(event) => onChange({ ...profile, declaredBplInitialSituation: { ...profile.declaredBplInitialSituation, recentExperienceSatisfied: event.target.value === "" ? null : event.target.value === "true" } })}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select></label>
    {(profile.declaredBplInitialSituation.referenceDateIso || profile.declaredBplInitialSituation.recentExperienceSatisfied !== null) && <button className={styles.deleteAction} type="button" onClick={onDeleteBpl}>Supprimer la déclaration BPL</button>}</div>
    {profile.commercialOperationsEnabled && ["HOT_AIR_BALLOON", "GAS_BALLOON"].map((classId) => { const item = profile.declaredCommercialInitialSituations.find((value) => value.balloonClass.classId === classId); return <div className={styles.declarationClass} key={classId}><h3>{qualificationClassLabel(classId)}</h3><label><span>Date de référence</span><input type="date" value={item?.referenceDateIso ?? ""} onChange={(event) => setCommercial(classId, "referenceDateIso", event.target.value || null)} /></label><label><span>Récence commerciale satisfaite ?</span><select value={answer(item?.recencySatisfied ?? null)} onChange={(event) => setCommercial(classId, "recencySatisfied", event.target.value === "" ? null : event.target.value === "true")}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select></label>{item && (item.referenceDateIso || item.recencySatisfied !== null) && <button className={styles.deleteAction} type="button" onClick={() => onDeleteCommercial(classId)}>Supprimer cette déclaration</button>}</div>; })}
    <button className={`${styles.save} ${styles.eventFormWide}`} type="submit">Enregistrer</button>
  </form>;
}

function QualificationSettingsForm({ priority = false, settings, onChange, onSubmit }: {
  priority?: boolean;
  settings: QualificationProfile;
  onChange: (settings: QualificationProfile) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const toggleBplClass = (classId: "HOT_AIR_BALLOON" | "GAS_BALLOON", checked: boolean) => onChange({
    ...settings,
    bplBalloonClasses: checked
      ? [...settings.bplBalloonClasses, classId]
      : settings.bplBalloonClasses.filter((value) => value !== classId),
  });
  return <form className={`${styles.settings} ${priority ? styles.prioritySettings : ""}`} onSubmit={onSubmit}>
    <h2>{priority ? "Configurer votre profil" : "Modifier ma situation"}</h2>
    {priority && <p className={styles.priorityText}>Configurez votre profil pour calculer vos qualifications et validités.</p>}
    <div className={styles.settingsGrid}>
      <label htmlFor="qualification-licence-type"><span>Type de licence</span><select id="qualification-licence-type" value={settings.licenceType ?? ""} onChange={(event) => onChange({ ...settings, licenceType: event.target.value || null })}><option value="">Non renseigné</option><option value="BPL">BPL</option><option value="OTHER">Autre</option></select></label>
      <div className={styles.privileges}><span>PRIVILÈGES BPL</span><label className={styles.toggle}><input type="checkbox" checked={settings.bplBalloonClasses.includes("HOT_AIR_BALLOON")} onChange={(event) => toggleBplClass("HOT_AIR_BALLOON", event.target.checked)} /><span>Ballon libre à air chaud</span></label><label className={styles.toggle}><input type="checkbox" checked={settings.bplBalloonClasses.includes("GAS_BALLOON")} onChange={(event) => toggleBplClass("GAS_BALLOON", event.target.checked)} /><span>Ballon libre à gaz</span></label></div>
      {settings.bplBalloonClasses.includes("HOT_AIR_BALLOON") && <label className={styles.privilegeGroup}><span>Groupe hot-air maximal détenu</span><select value={settings.hotAirBalloonGroupPrivilege ?? ""} onChange={(event) => onChange({ ...settings, hotAirBalloonGroupPrivilege: (["A", "B", "C", "D"].includes(event.target.value) ? event.target.value : null) as QualificationProfile["hotAirBalloonGroupPrivilege"] })}><option value="">Non renseigné</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select><small>Le groupe maximal inscrit dans vos privilèges ; les groupes inférieurs sont inclus.</small></label>}
      <label htmlFor="qualification-history-coverage"><span>Historique complet depuis</span><input id="qualification-history-coverage" type="date" value={settings.historyCoverageStartDate ?? ""} onChange={(event) => onChange({ ...settings, historyCoverageStartDate: event.target.value || null })} /></label>
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

function QualificationEventForm({ type, draft, error, editing, onChange, onCancel, onDelete, onSubmit }: {
  type: EditableQualificationEventType;
  draft: QualificationEventDraft;
  error: string;
  editing: boolean;
  onChange: (draft: QualificationEventDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
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
    {editing && onDelete && <button className={`${styles.deleteAction} ${styles.eventFormWide}`} type="button" onClick={onDelete}>Supprimer cette donnée</button>}
  </form>;
}

function BplEventForm({ type, mode, draft, ascensionId, ascensions, linkedEditing, error, onModeChange, onDraftChange, onAscensionChange, onCancel, onDelete, onSubmit }: {
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
  onDelete?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const training = type === "TRAINING_FLIGHT_BPL";
  const selectedAscension = ascensions.find(({ id }) => id === ascensionId);
  const hotAirEvent = mode === "HISTORICAL" ? draft.classId === "HOT_AIR_BALLOON" : selectedAscension?.category === "Libre à air chaud";
  return <form className={styles.eventForm} onSubmit={onSubmit}>
    <div className={styles.eventFormHeader}><h2>{training ? "Vol d’entraînement BPL" : "Contrôle de compétences BPL"}</h2><button type="button" onClick={onCancel}>Fermer</button></div>
    {!linkedEditing && <fieldset className={`${styles.originChoice} ${styles.eventFormWide}`}><legend>Origine</legend><label><input type="radio" name="bpl-origin" checked={mode === "LINKED"} onChange={() => onModeChange("LINKED")} /> Associer un vol du carnet</label><label><input type="radio" name="bpl-origin" checked={mode === "HISTORICAL"} onChange={() => onModeChange("HISTORICAL")} /> {training ? "Ajouter un vol historique" : "Ajouter un contrôle historique"}</label></fieldset>}
    {mode === "LINKED" ? <label className={styles.eventFormWide}><span>Ascension du carnet</span><select required disabled={linkedEditing} value={ascensionId} onChange={(event) => onAscensionChange(event.target.value)}><option value="">Choisir une ascension</option>{ascensions.map((ascension) => <option key={ascension.id} value={ascension.id}>{formatQualificationDate(ascension.dateIso)} · {ascension.registration} · {ascension.departure} → {ascension.arrival}</option>)}</select></label> : <><label><span>{training ? "Date du vol" : "Date du contrôle"}</span><input required type="date" value={draft.dateIso} onChange={(event) => onDraftChange({ ...draft, dateIso: event.target.value })} /></label><label><span>Classe ballon</span><select required value={draft.classId} onChange={(event) => onDraftChange({ ...draft, classId: event.target.value })}><option value="">Choisir</option><option value="HOT_AIR_BALLOON">Ballon libre à air chaud</option><option value="GAS_BALLOON">Ballon libre à gaz</option></select></label></>}
    {hotAirEvent && <label><span>Groupe du ballon utilisé</span><select required value={draft.groupId} onChange={(event) => onDraftChange({ ...draft, groupId: event.target.value })}><option value="">Choisir</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></label>}
    <label className={mode === "LINKED" ? styles.eventFormWide : undefined}><span>{training ? "Instructeur FI(B)" : "Examinateur FE(B)"}</span><input required value={draft.personName} onChange={(event) => onDraftChange({ ...draft, personName: event.target.value })} /></label>
    <label className={styles.eventFormWide}><span>Notes (facultatif)</span><textarea value={draft.notes} onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })} /></label>
    {error && <p className={styles.formError} role="alert">{error}</p>}
    <button className={`${styles.save} ${styles.eventFormWide}`} type="submit">Enregistrer</button>
    {onDelete && <button className={`${styles.deleteAction} ${styles.eventFormWide}`} type="button" onClick={onDelete}>Supprimer cette donnée</button>}
  </form>;
}

function InitialBplIssuanceForm({ draft, editing, error, onChange, onCancel, onDelete, onSubmit }: { draft: BplEventDraft; editing: boolean; error: string; onChange: (draft: BplEventDraft) => void; onCancel: () => void; onDelete?: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className={styles.eventForm} onSubmit={onSubmit}><div className={styles.eventFormHeader}><h2>{editing ? "Modifier" : "Ajouter"} — Délivrance initiale BPL</h2><button type="button" onClick={onCancel}>Fermer</button></div><label><span>Date de délivrance</span><input required type="date" value={draft.dateIso} onChange={(event) => onChange({ ...draft, dateIso: event.target.value })} /></label><label className={styles.eventFormWide}><span>Notes (facultatif)</span><textarea value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}<button className={`${styles.save} ${styles.eventFormWide}`} type="submit">Enregistrer</button>{editing && onDelete && <button className={`${styles.deleteAction} ${styles.eventFormWide}`} type="button" onClick={onDelete}>Supprimer cette donnée</button>}</form>;
}

function CommercialEventForm({ type, draft, editing, trainingEvents, error, onChange, onCancel, onDelete, onSubmit }: { type: EditableCommercialEventType; draft: CommercialEventDraft; editing: boolean; trainingEvents: readonly QualificationEvent[]; error: string; onChange: (draft: CommercialEventDraft) => void; onCancel: () => void; onDelete?: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const issuance = type === "INITIAL_COMMERCIAL_ISSUANCE";
  const check = type === "COMMERCIAL_PROFICIENCY_CHECK";
  const title = issuance ? "Délivrance initiale — activité professionnelle" : check ? "Contrôle de compétences professionnel" : "Formation / remise à niveau professionnelle";
  return <form className={styles.eventForm} onSubmit={onSubmit}>
    <div className={styles.eventFormHeader}><h2>{editing ? "Modifier" : "Ajouter"} — {title}</h2><button type="button" onClick={onCancel}>Fermer</button></div>
    <label><span>Date</span><input required type="date" value={draft.dateIso} onChange={(event) => onChange({ ...draft, dateIso: event.target.value })} /></label>
    <label><span>Classe ballon</span><select required value={draft.classId} onChange={(event) => onChange({ ...draft, classId: event.target.value, groupId: event.target.value === "HOT_AIR_BALLOON" ? draft.groupId : "" })}><option value="">Choisir</option><option value="HOT_AIR_BALLOON">Ballon libre à air chaud</option><option value="GAS_BALLOON">Ballon libre à gaz</option></select></label>
    {draft.classId === "HOT_AIR_BALLOON" && <label><span>Groupe du ballon utilisé</span><select required value={draft.groupId} onChange={(event) => onChange({ ...draft, groupId: event.target.value })}><option value="">Choisir</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></label>}
    {check && <label className={styles.eventFormWide}><span>Examinateur FE(B)</span><input required value={draft.personName} onChange={(event) => onChange({ ...draft, personName: event.target.value })} /></label>}
    {type === "COMMERCIAL_REFRESHER_COURSE" && <><label><span>Durée théorique (minutes)</span><input required inputMode="numeric" type="number" min="360" value={draft.theoryMinutes} onChange={(event) => onChange({ ...draft, theoryMinutes: event.target.value })} /></label><label><span>Vol associé avec FI(B)</span><select required value={draft.trainingEventId} onChange={(event) => onChange({ ...draft, trainingEventId: event.target.value })}><option value="">Choisir</option>{trainingEvents.filter((event) => event.balloonClass?.classId === draft.classId && (draft.classId !== "HOT_AIR_BALLOON" || event.balloonClass.groupId === draft.groupId)).map((event) => <option key={event.id} value={event.id}>{formatQualificationDate(event.dateIso)} · {event.instructor?.name}</option>)}</select></label></>}
    <label className={styles.eventFormWide}><span>Notes (facultatif)</span><textarea value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label>
    {error && <p className={styles.formError} role="alert">{error}</p>}<button className={`${styles.save} ${styles.eventFormWide}`} type="submit">Enregistrer</button>{editing && onDelete && <button className={`${styles.deleteAction} ${styles.eventFormWide}`} type="button" onClick={onDelete}>Supprimer cette donnée</button>}
  </form>;
}

const FI_B_EVENT_LABELS: Record<EditableFiBEventType, string> = { FI_B_REFRESHER_TRAINING: "Remise à niveau instructeur", FI_B_SUPERVISED_INSTRUCTION: "Instruction sous supervision", FI_B_ASSESSMENT_OF_COMPETENCE: "Évaluation de compétences FI(B)" };

function FiBEventForm({ type, draft, editing, ascensions, error, onChange, onCancel, onDelete, onSubmit }: { type: EditableFiBEventType; draft: FiBEventDraft; editing: boolean; ascensions: PilotQualificationsPageState["completion"]["officialAscensions"]; error: string; onChange: (draft: FiBEventDraft) => void; onCancel: () => void; onDelete?: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const refresher = type === "FI_B_REFRESHER_TRAINING";
  return <form className={styles.eventForm} onSubmit={onSubmit}><div className={styles.eventFormHeader}><h2>{editing ? "Modifier" : "Ajouter"} — {FI_B_EVENT_LABELS[type]}</h2><button type="button" onClick={onCancel}>Fermer</button></div><label><span>Date</span><input required type="date" value={draft.dateIso} onChange={(event) => onChange({ ...draft, dateIso: event.target.value })} /></label>{!refresher && <><label><span>Ascension liée (facultative)</span><select value={draft.officialAscensionId} onChange={(event) => onChange({ ...draft, officialAscensionId: event.target.value })}><option value="">Aucune</option>{ascensions.map((ascension) => <option key={ascension.id} value={ascension.id}>{formatQualificationDate(ascension.dateIso)} · {ascension.registration}</option>)}</select></label><label><span>Classe ballon (facultative)</span><select value={draft.classId} onChange={(event) => onChange({ ...draft, classId: event.target.value })}><option value="">Non renseignée</option><option value="HOT_AIR_BALLOON">Ballon libre à air chaud</option><option value="GAS_BALLOON">Ballon libre à gaz</option></select></label><label><span>{type === "FI_B_ASSESSMENT_OF_COMPETENCE" ? "Examinateur" : "Instructeur superviseur"} (facultatif)</span><input value={draft.personName} onChange={(event) => onChange({ ...draft, personName: event.target.value })} /></label></>}<label className={styles.eventFormWide}><span>Notes (facultatif)</span><textarea value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /></label>{error && <p className={styles.formError} role="alert">{error}</p>}<button className={`${styles.save} ${styles.eventFormWide}`} type="submit">Enregistrer</button>{editing && onDelete && <button className={`${styles.deleteAction} ${styles.eventFormWide}`} type="button" onClick={onDelete}>Supprimer cette donnée</button>}</form>;
}

function eventClassKeys(events: readonly QualificationEvent[], ascensions: PilotQualificationsPageState["completion"]["officialAscensions"], profile: QualificationProfile): QualificationBalloonClass[] {
  const values = [
    ...events.flatMap(({ balloonClass }) => balloonClass ? [balloonClass] : []),
    ...ascensions.map((ascension): QualificationBalloonClass => ({ classId: OFFICIAL_ASCENSION_CLASS_IDS[ascension.category] })),
    ...profile.declaredCommercialInitialSituations.map(({ balloonClass }) => balloonClass),
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
  const [initialSituationEditor, setInitialSituationEditor] = useState(false);
  const [initialSituationDraft, setInitialSituationDraft] = useState<QualificationProfile | null>(null);
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
  const [issuanceEditorOpen, setIssuanceEditorOpen] = useState(false);
  const [issuanceDraft, setIssuanceDraft] = useState<BplEventDraft>(() => emptyBplEventDraft());
  const [issuanceError, setIssuanceError] = useState("");
  const [issuanceEditedEventId, setIssuanceEditedEventId] = useState<string | undefined>();
  const [commercialEditor, setCommercialEditor] = useState<EditableCommercialEventType | null>(null);
  const [commercialDraft, setCommercialDraft] = useState<CommercialEventDraft>(() => emptyCommercialEventDraft());
  const [commercialEditedEventId, setCommercialEditedEventId] = useState<string | undefined>();
  const [commercialError, setCommercialError] = useState("");
  const [fiBEditor, setFiBEditor] = useState<EditableFiBEventType | null>(null);
  const [fiBDraft, setFiBDraft] = useState<FiBEventDraft>(() => emptyFiBEventDraft());
  const [fiBEditedEventId, setFiBEditedEventId] = useState<string | undefined>();
  const [fiBError, setFiBError] = useState("");
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
    if (!eventEditor && !bplEditor && !issuanceEditorOpen && !commercialEditor && !fiBEditor) return;
    const frame = window.requestAnimationFrame(() => eventEditorAnchor.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [eventEditor, bplEditor, issuanceEditorOpen, commercialEditor, fiBEditor]);

  const view = useMemo(() => {
    if (!qualifications || !qualifications.profile.configured) return null;
    const bplPrivileges = calculateBplPrivilegesMaintenance({ profile: qualifications.profile, events: qualifications.events, ascensions: completion.officialAscensions, referenceDateIso, ascensionHistoryComplete: true, historyCoverageStartDate: qualifications.profile.historyCoverageStartDate, openingBalance: completion.openingBalance });
    const bpl = bplPrivileges.referenceRequirement;
    const medical = calculateMedicalQualification({ events: qualifications.events, legacy: qualifications.legacy, referenceDateIso, requiredClass: "LAPL" });
    const commercialClasses = eventClassKeys(qualifications.events, completion.officialAscensions, qualifications.profile);
    const commercial = qualifications.profile.commercialOperationsEnabled
      ? commercialClasses.map((balloonClass) => calculateCommercialQualification({ profile: qualifications.profile, events: qualifications.events, ascensions: completion.officialAscensions, referenceDateIso, balloonClass, ascensionHistoryComplete: true, historyCoverageStartDate: qualifications.profile.historyCoverageStartDate }))
      : [];
    const credits = bplEventCredits(qualifications.events).filter(({ creditedFrom }) => creditedFrom === "COMMERCIAL_PROFICIENCY_CHECK" || creditedFrom === "COMMERCIAL_REFRESHER_COURSE");
    const fiB = evaluateFiBRecency({ profile: qualifications.profile, events: qualifications.events, ascensions: completion.officialAscensions, referenceDateIso, historyCoverageStartDate: qualifications.profile.historyCoverageStartDate });
    return { bpl, bplPrivileges, medical, commercialClasses, commercial, credits, fiB };
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
    setIssuanceEditorOpen(false);
  };

  const openIssuanceEditor = (existing?: QualificationEvent) => {
    setIssuanceDraft(emptyBplEventDraft(existing));
    setIssuanceEditedEventId(existing?.id);
    setIssuanceError("");
    setIssuanceEditorOpen(true);
    setEventEditor(null);
    setBplEditor(null);
  };

  const openCommercialEditor = (type: EditableCommercialEventType, existing?: QualificationEvent, classId = "") => {
    setCommercialEditor(type);
    setCommercialEditedEventId(existing?.id);
    setCommercialDraft({ ...emptyCommercialEventDraft(existing), classId: existing?.balloonClass?.classId ?? classId });
    setCommercialError("");
    setEventEditor(null);
    setBplEditor(null);
    setIssuanceEditorOpen(false);
  };

  const openFiBEditor = (type: EditableFiBEventType, existing?: QualificationEvent) => { setFiBEditor(type); setFiBEditedEventId(existing?.id); setFiBDraft(emptyFiBEventDraft(existing)); setFiBError(""); setEventEditor(null); setBplEditor(null); setCommercialEditor(null); };

  const submitFiBEvent = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!fiBEditor) return; const result = upsertFiBQualificationEvent(qualifications.events, fiBEditor, fiBDraft, fiBEditedEventId); if (!result.ok) { setFiBError(result.error); return; } if (!savePilotQualifications({ profile: qualifications.profile, events: result.events }, window.localStorage)) { setFiBError("Enregistrement local impossible."); return; } setQualifications({ ...qualifications, events: result.events }); setFiBEditor(null); };

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

  const issuanceEvent = [...qualifications.events].filter(({ type }) => type === "INITIAL_BPL_ISSUANCE").sort((left, right) => right.dateIso.localeCompare(left.dateIso))[0];
  const submitIssuance = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = upsertInitialBplIssuance(qualifications.events, issuanceDraft, issuanceEditedEventId);
    if (!result.ok) { setIssuanceError(result.error); return; }
    if (!savePilotQualifications({ profile: qualifications.profile, events: result.events }, window.localStorage)) { setIssuanceError("Enregistrement local impossible."); return; }
    setQualifications({ ...qualifications, events: result.events });
    setIssuanceEditorOpen(false);
  };

  const submitCommercialEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!commercialEditor) return;
    const result = upsertCommercialQualificationEvent(qualifications.events, commercialEditor, commercialDraft, commercialEditedEventId);
    if (!result.ok) { setCommercialError(result.error); return; }
    if (!savePilotQualifications({ profile: qualifications.profile, events: result.events }, window.localStorage)) { setCommercialError("Enregistrement local impossible."); return; }
    setQualifications({ ...qualifications, events: result.events });
    setCommercialEditor(null);
  };

  const deleteEvent = (eventId: string) => {
    if (!window.confirm("Supprimer cette donnée de qualification ?")) return;
    const events = removeQualificationEvent(qualifications.events, eventId);
    if (!savePilotQualifications({ profile: qualifications.profile, events }, window.localStorage)) return;
    setQualifications({ ...qualifications, events });
    setEventEditor(null);
    setBplEditor(null);
    setIssuanceEditorOpen(false);
    setCommercialEditor(null);
    setFiBEditor(null);
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

  const saveInitialSituation = (profile: QualificationProfile) => {
    const next = { ...qualifications, profile };
    if (!savePilotQualifications({ profile, events: qualifications.events }, window.localStorage)) return false;
    setQualifications(next);
    setSettings(profile);
    setInitialSituationDraft(profile);
    return true;
  };
  const submitInitialSituation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (initialSituationDraft && saveInitialSituation(initialSituationDraft)) setInitialSituationEditor(false);
  };
  const openInitialSituation = () => { setInitialSituationDraft(qualifications.profile); setInitialSituationEditor(true); };
  const deleteBplDeclaration = () => {
    if (!initialSituationDraft || !window.confirm("Supprimer la déclaration initiale BPL ?")) return;
    const profile = { ...initialSituationDraft, declaredBplInitialSituation: { referenceDateIso: null, recentExperienceSatisfied: null } };
    saveInitialSituation(profile);
  };
  const deleteCommercialDeclaration = (classId: string) => {
    if (!initialSituationDraft || !window.confirm("Supprimer cette déclaration initiale professionnelle ?")) return;
    const profile = { ...initialSituationDraft, declaredCommercialInitialSituations: initialSituationDraft.declaredCommercialInitialSituations.filter((item) => item.balloonClass.classId !== classId) };
    saveInitialSituation(profile);
  };

  if (!qualifications.profile.configured) return <main className={moreStyles.screen}><div className={moreStyles.layout}>
    <Link href="/more/profile" className={moreStyles.back}><ChevronLeft size={18} aria-hidden="true" /> Profil pilote</Link>
    <header><p className={moreStyles.eyebrow}>Profil pilote</p><h1 className={moreStyles.title}>Qualifications &amp; validité</h1></header>
    <QualificationSettingsForm priority settings={settings} onChange={setSettings} onSubmit={submitSettings} />
  </div><NavigationBar activeItem="Plus" /></main>;

  if (!view) return null;
  const experience = view.bpl?.recentExperience.currentValue ?? { officialDurationMinutes: 0, ascensions: 0, takeoffs: 0, landings: 0 };
  const medicalEvent = latestEvent("MEDICAL");
  const firstAidEvent = latestEvent("FIRST_AID");
  const fireEvent = latestEvent("FIRE_TRAINING");
  const trainingEvent = [...qualifications.events].filter(({ type }) => type === "TRAINING_FLIGHT_BPL").sort((left, right) => right.dateIso.localeCompare(left.dateIso))[0];
  const proficiencyEvent = [...qualifications.events].filter(({ type }) => type === "PROFICIENCY_CHECK_BPL").sort((left, right) => right.dateIso.localeCompare(left.dateIso))[0];
  const commercialIssuances = qualifications.events.filter(({ type }) => type === "INITIAL_COMMERCIAL_ISSUANCE");
  const commercialTrainingEvents = qualifications.events.filter(({ type, instructor }) => type === "TRAINING_FLIGHT_BPL" && instructor?.name);
  const trainingReferenceEvent = qualifications.events.find(({ id }) => view.bpl?.trainingFlightFiB.sourceEventIds?.includes(id));
  const firstAid = calculateProfessionalTrainingStatus({ profile: qualifications.profile, events: qualifications.events, type: "FIRST_AID", referenceDateIso });
  const fire = calculateProfessionalTrainingStatus({ profile: qualifications.profile, events: qualifications.events, type: "FIRE_TRAINING", referenceDateIso });
  const otherEvents = qualifications.events.filter(({ type }) => type === "OTHER_TRAINING").sort((a, b) => b.dateIso.localeCompare(a.dateIso));
  const history = [...qualifications.events].sort((a, b) => b.dateIso.localeCompare(a.dateIso) || b.createdAt.localeCompare(a.createdAt));
  const unknownCommercial: QualificationRequirementResult = { status: "UNKNOWN", reason: "Classe commerciale inconnue." };
  const commercialSummary = view.commercial.length ? mostRestrictiveQualificationResult(view.commercial.map(({ overall }) => overall)) : unknownCommercial;
  const missingCommercialAccess = view.commercial.filter(({ initialAccess }) => initialAccess.status === "UNKNOWN");
  const needsInitialSituation = Boolean(view.bpl && view.bpl.recentExperience.status === "UNKNOWN") || view.commercial.some(({ recency }) => recency.status === "UNKNOWN");
  const summary: Array<readonly [string, QualificationRequirementResult]> = [
    ["BPL", view.bplPrivileges.overall],
    ["Médical", view.medical.overall],
    ...(qualifications.profile.commercialOperationsEnabled ? [["Activité professionnelle", commercialSummary] as const] : []),
  ];
  const actionItems: Array<Readonly<{ text: string; href?: string; initialSituation?: boolean; editor?: EditableQualificationEventType; bplType?: EditableBplEventType; commercialType?: EditableCommercialEventType; commercialClassId?: string; buttonLabel?: string }>> = [
    ...(["UNKNOWN", "ACTION_REQUIRED"].includes(view.medical.overall.status) ? [{ text: medicalEvent ? "Mettre à jour votre médical" : "Renseigner votre classe médicale", editor: "MEDICAL" as const, buttonLabel: medicalEvent ? "Modifier" : "Renseigner" }] : []),
    ...(needsInitialSituation ? [{ text: "Renseigner ma situation initiale", initialSituation: true, buttonLabel: "Renseigner" }] : []),
    ...(view.bpl && view.bpl.recentExperience.status !== "UNKNOWN" && ["UNKNOWN", "ACTION_REQUIRED"].includes(view.bpl.trainingFlightFiB.status) ? [{ text: issuanceEvent ? "Enregistrer un nouveau vol d’entraînement" : "Renseigner votre délivrance BPL ou un vol d’entraînement", bplType: "TRAINING_FLIGHT_BPL" as const, buttonLabel: "Ajouter" }] : []),
    ...(view.bpl && view.bpl.recentExperience.status !== "UNKNOWN" && ["UNKNOWN", "ACTION_REQUIRED"].includes(view.bpl.proficiencyCheckFeB.status) ? [{ text: "Utiliser la voie alternative par contrôle de compétences", bplType: "PROFICIENCY_CHECK_BPL" as const, buttonLabel: proficiencyEvent ? "Modifier" : "Ajouter" }] : []),
    ...(qualifications.profile.commercialOperationsEnabled && view.commercial.length === 0 ? [{ text: "Renseigner votre accès initial à l’activité professionnelle", commercialType: "INITIAL_COMMERCIAL_ISSUANCE" as const, buttonLabel: "Ajouter" }] : []),
    ...missingCommercialAccess.map(({ balloonClass }) => ({ text: `Renseigner l’accès initial — ${qualificationClassLabel(balloonClass.classId)}`, commercialType: "INITIAL_COMMERCIAL_ISSUANCE" as const, commercialClassId: balloonClass.classId, buttonLabel: "Ajouter" })),
    ...(qualifications.profile.commercialOperationsEnabled && ["UNKNOWN", "ACTION_REQUIRED"].includes(firstAid.status) ? [{ text: firstAidEvent ? "Compléter ou renouveler votre PSC1" : "Renseigner votre formation PSC1", editor: "FIRST_AID" as const, buttonLabel: firstAidEvent ? "Modifier" : "Ajouter" }] : []),
    ...(qualifications.profile.commercialOperationsEnabled && ["UNKNOWN", "ACTION_REQUIRED"].includes(fire.status) ? [{ text: fireEvent ? "Compléter ou renouveler votre formation incendie" : "Renseigner votre formation incendie", editor: "FIRE_TRAINING" as const, buttonLabel: fireEvent ? "Modifier" : "Ajouter" }] : []),
  ];

  return <main className={moreStyles.screen}><div className={moreStyles.layout}>
    <Link href="/more/profile" className={moreStyles.back}><ChevronLeft size={18} aria-hidden="true" /> Profil pilote</Link>
    <header className={styles.header}><div><p className={moreStyles.eyebrow}>Profil pilote</p><h1 className={moreStyles.title}>Qualifications &amp; validité</h1></div><button className={styles.edit} type="button" onClick={() => setEditing((value) => !value)}>Modifier ma situation</button></header>

    {editing && <QualificationSettingsForm settings={settings} onChange={setSettings} onSubmit={submitSettings} />}

    <section className={styles.summary} aria-label="Résumé de la situation pilote">
      {summary.map(([label, result]) => <article className={styles.summaryCard} key={label}><span>{label}{result.provenance === "DECLARED_BY_PILOT" && <small>Déclaré par le pilote</small>}</span><strong data-status={result.status}>{pilotStatusLabel(result.status, label === "Médical")}</strong></article>)}
    </section>

    {actionItems.length > 0 && <section className={`${styles.section} ${styles.todo}`} aria-labelledby="todo-title"><h2 id="todo-title">À faire</h2><ul>{actionItems.map((item) => <li key={item.text}><span>{item.text}</span>{item.href && <Link href={item.href}>{item.buttonLabel}</Link>}{item.initialSituation && <button type="button" onClick={openInitialSituation}>{item.buttonLabel}</button>}{item.editor && <button type="button" onClick={() => openEventEditor(item.editor!)}>{item.buttonLabel}</button>}{item.bplType && <button type="button" onClick={() => openBplEditor(item.bplType!)}>{item.buttonLabel}</button>}{item.commercialType && <button type="button" onClick={() => openCommercialEditor(item.commercialType!, undefined, item.commercialClassId)}>{item.buttonLabel}</button>}</li>)}</ul></section>}
    {initialSituationEditor && initialSituationDraft && <InitialSituationForm profile={initialSituationDraft} onChange={setInitialSituationDraft} onCancel={() => setInitialSituationEditor(false)} onSubmit={submitInitialSituation} onDeleteBpl={deleteBplDeclaration} onDeleteCommercial={deleteCommercialDeclaration} />}

    <section className={styles.section} aria-labelledby="bpl-title"><div className={styles.sectionHeader}><h2 id="bpl-title">Maintien BPL</h2><StatusBadge status={view.bplPrivileges.overall.status} /></div>
      {view.bplPrivileges.classResults.map(({ balloonClass, requirement, result, groupLimitation }) => <CompactRequirement key={balloonClass.classId} title={qualificationClassLabel(balloonClass.classId)} result={result}><p>{requirement === "BFCL_160_A" ? "Classe de référence · BFCL.160(a)" : `${Number(result.currentValue ?? 0)} / 180 min sur 24 mois · BFCL.160(b)`}</p>{groupLimitation && <p>Groupe détenu : {groupLimitation.pilotPrivilegeGroup ?? "non renseigné"} · Groupe actuellement exerçable : {groupLimitation.exercisableGroup ? `A à ${groupLimitation.exercisableGroup}` : "non déterminable"}</p>}</CompactRequirement>)}
      {!view.bpl && <p className={styles.compactText}>Renseignez vos privilèges BPL pour évaluer le maintien par classe.</p>}
      {view.bpl && <>
      <CompactRequirement title="Expérience récente — 24 mois" result={view.bpl.recentExperience}><p>{Math.floor(experience.officialDurationMinutes / 60)} h {experience.officialDurationMinutes % 60} / 6 h · {experience.takeoffs} / 10 décollages · {experience.landings} / 10 atterrissages</p>{view.bpl.recentExperience.status === "UNKNOWN" && <Link className={styles.historyLink} href="/journal/ascension/new">Compléter mon historique récent →</Link>}</CompactRequirement>
      <CompactRequirement title="Maintien périodique / vol d’entraînement" result={view.bpl.trainingFlightFiB}><p>{trainingReferenceEvent?.type === "INITIAL_BPL_ISSUANCE" ? `Référence actuelle : délivrance BPL du ${formatQualificationDate(trainingReferenceEvent.dateIso)} · prochain vol d’entraînement ${formatQualificationDate(view.bpl.trainingFlightFiB.dueDate)}` : typeof view.bpl.trainingFlightFiB.currentValue === "string" ? `Dernier vol d’entraînement : ${formatQualificationDate(view.bpl.trainingFlightFiB.currentValue)} · échéance ${formatQualificationDate(view.bpl.trainingFlightFiB.dueDate)}` : "Aucune référence de maintien périodique"}</p><button className={styles.inlineAction} type="button" onClick={() => openBplEditor("TRAINING_FLIGHT_BPL", trainingEvent)}>{trainingEvent ? "Modifier" : "Ajouter un vol"}</button><button className={styles.inlineAction} type="button" onClick={() => openIssuanceEditor(issuanceEvent)}>{issuanceEvent ? "Modifier la délivrance" : "Renseigner la délivrance"}</button></CompactRequirement>
      {view.bpl.proficiencyCheckFeB.status !== "NON_APPLICABLE" && <CompactRequirement title="Voie alternative par contrôle de compétences" result={view.bpl.proficiencyCheckFeB}><p>{typeof view.bpl.proficiencyCheckFeB.currentValue === "string" ? `Dernier contrôle : ${formatQualificationDate(view.bpl.proficiencyCheckFeB.currentValue)} · échéance ${formatQualificationDate(view.bpl.proficiencyCheckFeB.dueDate)}` : "À utiliser si la voie normale n’est pas satisfaite"}</p><button className={styles.inlineAction} type="button" onClick={() => openBplEditor("PROFICIENCY_CHECK_BPL", proficiencyEvent)}>{proficiencyEvent ? "Modifier" : "Ajouter"}</button></CompactRequirement>}
      {issuanceEditorOpen && <div ref={eventEditorAnchor}><InitialBplIssuanceForm draft={issuanceDraft} editing={Boolean(issuanceEditedEventId)} error={issuanceError} onChange={setIssuanceDraft} onCancel={() => setIssuanceEditorOpen(false)} onDelete={issuanceEditedEventId ? () => deleteEvent(issuanceEditedEventId) : undefined} onSubmit={submitIssuance} /></div>}
      {bplEditor && <div ref={eventEditorAnchor}><BplEventForm type={bplEditor} mode={bplMode} draft={bplDraft} ascensionId={bplAscensionId} ascensions={[...completion.officialAscensions].filter((ascension) => ascension.flightNature === (bplEditor === "TRAINING_FLIGHT_BPL" ? "TRAINING_BPL" : "PROFICIENCY_CHECK_BPL")).sort((left, right) => right.dateIso.localeCompare(left.dateIso))} linkedEditing={Boolean(bplEditedEventId && bplMode === "LINKED")} error={bplError} onModeChange={setBplMode} onDraftChange={setBplDraft} onAscensionChange={setBplAscensionId} onCancel={() => setBplEditor(null)} onDelete={bplEditedEventId ? () => deleteEvent(bplEditedEventId) : undefined} onSubmit={submitBplEvent} /></div>}
      </>}
    </section>

    {qualifications.profile.fiBEnabled && <section className={styles.section} aria-labelledby="fi-b-title"><div className={styles.sectionHeader}><h2 id="fi-b-title">Maintien FI(B)</h2><StatusBadge status={view.fiB.status} /></div>
      <CompactRequirement title="Instruction récente" result={view.fiB.instructionRequirementStatus}><p>{Math.floor(view.fiB.instructionMinutes36m / 60)} h {view.fiB.instructionMinutes36m % 60} / 6 h — 3 ans</p></CompactRequirement>
      {(["FI_B_REFRESHER_TRAINING", "FI_B_SUPERVISED_INSTRUCTION"] as const).map((type) => { const result = type === "FI_B_REFRESHER_TRAINING" ? view.fiB.refresherRequirementStatus : view.fiB.supervisedInstructionRequirementStatus; const existing = qualifications.events.filter((event) => event.type === type).sort((a, b) => b.dateIso.localeCompare(a.dateIso))[0]; return <CompactRequirement key={type} title={type === "FI_B_REFRESHER_TRAINING" ? "Remise à niveau instructeur" : "Instruction sous supervision"} result={result}><p>{typeof result.currentValue === "string" ? formatQualificationDate(result.currentValue) : "Manquante"} — {type === "FI_B_REFRESHER_TRAINING" ? "3 ans" : "9 ans"}</p><button className={styles.inlineAction} type="button" onClick={() => openFiBEditor(type, existing)}>{existing ? "Modifier" : "Ajouter"}</button></CompactRequirement>; })}
      <button className={styles.inlineAction} type="button" onClick={() => openFiBEditor("FI_B_ASSESSMENT_OF_COMPETENCE")}>Ajouter une évaluation de compétences</button>
      {fiBEditor && <div ref={eventEditorAnchor}><FiBEventForm type={fiBEditor} draft={fiBDraft} editing={Boolean(fiBEditedEventId)} ascensions={completion.officialAscensions} error={fiBError} onChange={setFiBDraft} onCancel={() => setFiBEditor(null)} onDelete={fiBEditedEventId ? () => deleteEvent(fiBEditedEventId) : undefined} onSubmit={submitFiBEvent} /></div>}
    </section>}

    <section className={styles.section} aria-labelledby="medical-title"><div className={styles.sectionHeader}><h2 id="medical-title">Médical</h2><StatusBadge status={view.medical.overall.status} /></div>
      <p className={styles.compactText}>{medicalEvent?.medicalClass ? `${medicalClassLabel(medicalEvent.medicalClass)} · échéance ${formatQualificationDate(view.medical.expiry.dueDate)}` : "Classe médicale à renseigner dans l’historique"}</p>
      {!medicalEvent?.medicalClass && qualifications.legacy.medicalDueDateIso && <p className={styles.legacyHint}>Échéance antérieure conservée ; classe médicale à renseigner.</p>}
      <button className={styles.inlineAction} type="button" onClick={() => openEventEditor("MEDICAL")}>{medicalEvent ? "Modifier" : "Renseigner"}</button>
      {eventEditor === "MEDICAL" && <div ref={eventEditorAnchor}><QualificationEventForm type={eventEditor} draft={eventDraft} error={eventError} editing={Boolean(editedEventId)} onChange={setEventDraft} onCancel={() => setEventEditor(null)} onDelete={editedEventId ? () => deleteEvent(editedEventId) : undefined} onSubmit={submitEvent} /></div>}
    </section>

    {qualifications.profile.commercialOperationsEnabled && <section className={styles.section} aria-labelledby="commercial-title"><div className={styles.sectionHeader}><h2 id="commercial-title">Activité professionnelle</h2><StatusBadge status={commercialSummary.status} /></div>
      {view.commercial.length === 0 ? <><p className={styles.compactText}>Accès initial professionnel à renseigner.</p><button className={styles.inlineAction} type="button" onClick={() => openCommercialEditor("INITIAL_COMMERCIAL_ISSUANCE")}>Ajouter ma délivrance</button></> : view.commercial.map((commercial) => { const classId = commercial.balloonClass.classId; const issuance = commercialIssuances.find((event) => event.balloonClass?.classId === classId); const check = qualifications.events.find((event) => event.type === "COMMERCIAL_PROFICIENCY_CHECK" && event.balloonClass?.classId === classId); const course = qualifications.events.find((event) => event.type === "COMMERCIAL_REFRESHER_COURSE" && event.balloonClass?.classId === classId); const recencyValue = commercial.recency.currentValue as { picFlights?: number; flightsInClass?: number; supervisedFlightsInClass?: number } | undefined; return <article className={styles.commercialClass} key={`${classId}:${commercial.balloonClass.groupId ?? ""}`}><h3>{qualificationClassLabel(classId)}{commercial.balloonClass.groupId ? ` · ${commercial.balloonClass.groupId}` : ""}</h3>
        <CompactRequirement title="Accès initial" result={commercial.initialAccess}><p>{issuance ? `Délivrance du ${formatQualificationDate(issuance.dateIso)}` : "Non renseigné"}</p><button className={styles.inlineAction} type="button" onClick={() => openCommercialEditor("INITIAL_COMMERCIAL_ISSUANCE", issuance, classId)}>{issuance ? "Modifier" : "Ajouter ma délivrance"}</button></CompactRequirement>
        <CompactRequirement title="Récence — 180 jours" result={commercial.recency}><p>{recencyValue?.picFlights ?? 0} vols PIC acquis · {recencyValue?.flightsInClass ?? 0} dans cette classe</p>{commercial.recency.status === "UNKNOWN" && <Link className={styles.historyLink} href="/journal/ascension/new">Compléter mon historique récent →</Link>}</CompactRequirement>
        {commercial.proficiencyCheckFeB.status !== "NON_APPLICABLE" && <CompactRequirement title="Voie alternative — contrôle de compétences" result={commercial.proficiencyCheckFeB}><button className={styles.inlineAction} type="button" onClick={() => openCommercialEditor("COMMERCIAL_PROFICIENCY_CHECK", check, classId)}>{check ? "Modifier" : "Ajouter"}</button></CompactRequirement>}
        {commercial.refresherCourse.status !== "NON_APPLICABLE" && <CompactRequirement title="Voie alternative — formation / remise à niveau" result={commercial.refresherCourse}><button className={styles.inlineAction} type="button" onClick={() => openCommercialEditor("COMMERCIAL_REFRESHER_COURSE", course, classId)}>{course ? "Modifier" : "Ajouter"}</button></CompactRequirement>}
      </article>; })}
      {commercialEditor && <div ref={eventEditorAnchor}><CommercialEventForm type={commercialEditor} draft={commercialDraft} editing={Boolean(commercialEditedEventId)} trainingEvents={commercialTrainingEvents} error={commercialError} onChange={setCommercialDraft} onCancel={() => setCommercialEditor(null)} onDelete={commercialEditedEventId ? () => deleteEvent(commercialEditedEventId) : undefined} onSubmit={submitCommercialEvent} /></div>}
      <CompactRequirement title="Premiers secours / PSC1" result={firstAid}><p>{firstAidEvent ? `${formatQualificationDate(firstAidEvent.dateIso)}${firstAidEvent.expiryDateIso ? ` · échéance ${formatQualificationDate(firstAidEvent.expiryDateIso)}` : " · sans échéance renseignée"}` : "Formation non renseignée"}</p><button className={styles.inlineAction} type="button" onClick={() => openEventEditor("FIRST_AID")}>{firstAidEvent ? "Modifier" : "Ajouter"}</button></CompactRequirement>
      <CompactRequirement title="Formation incendie" result={fire}><p>{fireEvent ? `${formatQualificationDate(fireEvent.dateIso)}${fireEvent.expiryDateIso ? ` · échéance ${formatQualificationDate(fireEvent.expiryDateIso)}` : " · sans échéance renseignée"}` : "Formation non renseignée"}</p><button className={styles.inlineAction} type="button" onClick={() => openEventEditor("FIRE_TRAINING")}>{fireEvent ? "Modifier" : "Ajouter"}</button></CompactRequirement>
      {(eventEditor === "FIRST_AID" || eventEditor === "FIRE_TRAINING") && <div ref={eventEditorAnchor}><QualificationEventForm type={eventEditor} draft={eventDraft} error={eventError} editing={Boolean(editedEventId)} onChange={setEventDraft} onCancel={() => setEventEditor(null)} onDelete={editedEventId ? () => deleteEvent(editedEventId) : undefined} onSubmit={submitEvent} /></div>}
      {otherEvents.map((event) => <p className={styles.compactText} key={event.id}>{event.organization || "Autre formation"} · {formatQualificationDate(event.dateIso)}</p>)}
    </section>}

    <section className={styles.section} aria-labelledby="history-title"><h2 id="history-title">Historique</h2><div className={styles.history}>{history.length ? history.map((event) => <article className={styles.historyItem} key={event.id}><h3>{qualificationEventLabel(event.type)}</h3><div className={styles.historyMeta}><span>{formatQualificationDate(event.dateIso)}</span>{event.expiryDateIso && <span>Échéance : {formatQualificationDate(event.expiryDateIso)}</span>}{event.balloonClass && <span>Classe : {qualificationClassLabel(event.balloonClass.classId)}</span>}{event.organization && <span>Organisme : {event.organization}</span>}{event.instructor && <span>FI(B) : {event.instructor.name}</span>}{event.examiner && <span>FE(B) : {event.examiner.name}</span>}</div>{event.type === "INITIAL_BPL_ISSUANCE" && <button className={styles.inlineAction} type="button" onClick={() => openIssuanceEditor(event)}>Modifier</button>}{(event.type === "TRAINING_FLIGHT_BPL" || event.type === "PROFICIENCY_CHECK_BPL") && <><p className={styles.linkKind}>{event.officialAscensionId ? "Lié au carnet" : "Historique — non lié au carnet"}</p><button className={styles.inlineAction} type="button" onClick={() => openBplEditor(event.type as EditableBplEventType, event)}>Modifier</button></>}{(event.type === "INITIAL_COMMERCIAL_ISSUANCE" || event.type === "COMMERCIAL_PROFICIENCY_CHECK" || event.type === "COMMERCIAL_REFRESHER_COURSE") && <button className={styles.inlineAction} type="button" onClick={() => openCommercialEditor(event.type as EditableCommercialEventType, event)}>Modifier</button>}{event.type.startsWith("FI_B_") && <button className={styles.inlineAction} type="button" onClick={() => openFiBEditor(event.type as EditableFiBEventType, event)}>Modifier</button>}{event.officialAscensionId && (event.officialAscensionDeletedAt ? <p className={styles.deleted}>Ascension liée supprimée — preuve réglementaire conservée</p> : <Link className={styles.historyLink} href={`/journal/ascension/${encodeURIComponent(event.officialAscensionId)}`}>Voir l’ascension liée →</Link>)}</article>) : <p className={styles.empty}>Aucun événement de qualification enregistré.</p>}</div></section>

    <button className={styles.editBottom} type="button" onClick={() => { setSettings(qualifications.profile); setEditing(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Modifier ma situation</button>
  </div><NavigationBar activeItem="Plus" /></main>;
}
