"use client";

import { ChevronLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useBalloons } from "../../hooks/useBalloons";
import { balloonDisplayName, officialFieldsForBalloon } from "../../lib/balloons";
import { NEW_BALLOON_RETURN_KEY, NEW_BALLOON_SELECTION_KEY } from "../../lib/balloonStorage";
import { roundJournalAltitudeMeters, type OfficialAscensionInput, type OfficialFlightNature } from "../../lib/flightCompletion";
import { createScopedOfficialAscensionDraft, parseScopedOfficialAscensionDraft } from "../../lib/officialAscensionDraft";
import { flightNatureRequiresExaminer, flightNatureRequiresInstructor } from "../../lib/officialAscensionQualifications";
import styles from "../../flight/complete/FlightComplete.module.css";

const ADD_BALLOON_VALUE = "__add_balloon__";
const MANUAL_BALLOON_VALUE = "__manual_balloon__";
const DRAFT_KEY = "balloon-companion-official-ascension-draft";

export type OfficialAscensionFormValues = {
  dateIso: string;
  balloonModel: string;
  balloonManufacturer: string;
  registration: string;
  departure: string;
  arrival: string;
  category: OfficialAscensionInput["category"] | "";
  pilotFunction: OfficialAscensionInput["pilotFunction"] | "";
  nightFlight: boolean | null;
  maximumAltitudeM: string;
  officialDurationMinutes: number | null;
  flightNature: OfficialFlightNature;
  takeoffCount: string;
  landingCount: string;
  instructorName: string;
  instructorLicenceNumber: string;
  examinerName: string;
  examinerLicenceNumber: string;
  observations: string;
};

export type OfficialAscensionFormMode = "CREATE" | "VALIDATE" | "EDIT";

type Props = { mode: OfficialAscensionFormMode; ascensionId?: string; title: string; subtitle?: string; backLabel: string; submitLabel: string; gpsDurationMinutes?: number; manualDateEntry?: boolean; nativeSubmit?: boolean; initialValues: OfficialAscensionFormValues; onCancel: (dirty: boolean) => void; onSubmit: (input: OfficialAscensionInput) => boolean | void | Promise<boolean | void> };

export default function OfficialAscensionForm({ mode, ascensionId, title, subtitle, backLabel, submitLabel, gpsDurationMinutes, manualDateEntry = false, nativeSubmit = false, initialValues, onCancel, onSubmit }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const balloons = useBalloons();
  const [values, setValues] = useState(() => ({
    ...initialValues,
    maximumAltitudeM: initialValues.maximumAltitudeM === "" ? "" : String(roundJournalAltitudeMeters(Number(initialValues.maximumAltitudeM)) ?? ""),
  }));
  const [selectedBalloonId, setSelectedBalloonId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(initialValues.officialDurationMinutes === null ? "" : String(initialValues.officialDurationMinutes));
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const restoredRef = useRef(false);

  const selectedBalloon = balloons.find(({ id }) => id === selectedBalloonId);
  const inferredBalloonId = useMemo(() => balloons.find(({ registration }) => registration === values.registration)?.id ?? "", [balloons, values.registration]);

  useEffect(() => {
    if (restoredRef.current) return;
    const timer = window.setTimeout(() => {
      if (restoredRef.current) return;
      restoredRef.current = true;
      const rawDraft = window.sessionStorage.getItem(DRAFT_KEY);
      const returnedId = window.sessionStorage.getItem(NEW_BALLOON_SELECTION_KEY);
      const draft = parseScopedOfficialAscensionDraft<OfficialAscensionFormValues>(rawDraft, pathname);
      if (draft) {
        setValues(draft.values);
        setDurationMinutes(draft.durationMinutes);
        setDirty(true);
      }
      window.sessionStorage.removeItem(DRAFT_KEY);
      setSelectedBalloonId(returnedId || "");
      window.sessionStorage.removeItem(NEW_BALLOON_SELECTION_KEY);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    if (!hydrated || selectedBalloonId || !inferredBalloonId) return;
    const timer = window.setTimeout(() => setSelectedBalloonId(inferredBalloonId), 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, inferredBalloonId, selectedBalloonId]);

  useEffect(() => { const protect = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect); }, [dirty]);
  useEffect(() => {
    if (!selectedBalloon) return;
    const timer = window.setTimeout(() => setValues((current) => ({ ...current, ...officialFieldsForBalloon(selectedBalloon) })), 0);
    return () => window.clearTimeout(timer);
  }, [selectedBalloon]);

  const duration = durationMinutes === "" ? Number.NaN : Number(durationMinutes);
  const altitude = values.maximumAltitudeM === "" ? null : Number(values.maximumAltitudeM);
  const takeoffCount = values.takeoffCount === "" ? undefined : Number(values.takeoffCount);
  const landingCount = values.landingCount === "" ? undefined : Number(values.landingCount);
  const validAltitude = altitude === null || Number.isFinite(altitude) && altitude >= 0;
  const validMovements = (takeoffCount === undefined || Number.isInteger(takeoffCount) && takeoffCount >= 0) && (landingCount === undefined || Number.isInteger(landingCount) && landingCount >= 0);
  const validPeople = (!flightNatureRequiresInstructor(values.flightNature) || Boolean(values.instructorName.trim())) && (!flightNatureRequiresExaminer(values.flightNature) || Boolean(values.examinerName.trim()));
  const valid = Boolean(values.dateIso && values.balloonModel.trim() && values.registration.trim() && values.departure.trim() && values.arrival.trim() && values.category && values.pilotFunction && Number.isInteger(duration) && duration > 0 && validAltitude && validMovements && validPeople);

  const update = <K extends keyof OfficialAscensionFormValues>(key: K, value: OfficialAscensionFormValues[K]) => { setValues((current) => ({ ...current, [key]: value })); setDirty(true); };
  const chooseBalloon = (id: string) => {
    if (id === ADD_BALLOON_VALUE) {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(createScopedOfficialAscensionDraft(pathname, values, durationMinutes)));
      window.sessionStorage.setItem(NEW_BALLOON_RETURN_KEY, pathname);
      router.push("/more/profile/balloons/new");
      return;
    }
    if (id === MANUAL_BALLOON_VALUE) { setSelectedBalloonId(""); setDirty(true); return; }
    const balloon = balloons.find((item) => item.id === id);
    if (!balloon) return;
    setSelectedBalloonId(id);
    setValues((current) => ({ ...current, ...officialFieldsForBalloon(balloon) }));
    setDirty(true);
  };
  const submit = async () => {
    if (!valid || !values.category || !values.pilotFunction || isSubmitting) return;
    if (mode === "EDIT" && (!hydrated || !dirty || !ascensionId)) return;
    setIsSubmitting(true);
    const input: OfficialAscensionInput = { dateIso: values.dateIso, date: new Date(`${values.dateIso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), balloonModel: values.balloonModel.trim(), ...(values.balloonManufacturer.trim() ? { balloonManufacturer: values.balloonManufacturer.trim() } : {}), registration: values.registration.trim().toUpperCase(), departure: values.departure.trim(), arrival: values.arrival.trim(), category: values.category, pilotFunction: values.pilotFunction, nightFlight: values.nightFlight ?? false, maximumAltitudeM: roundJournalAltitudeMeters(altitude), officialDurationMinutes: duration, flightNature: values.flightNature, ...(takeoffCount === undefined ? {} : { takeoffCount }), ...(landingCount === undefined ? {} : { landingCount }), ...(flightNatureRequiresInstructor(values.flightNature) ? { instructor: { name: values.instructorName.trim(), ...(values.instructorLicenceNumber.trim() ? { licenceNumber: values.instructorLicenceNumber.trim() } : {}) } } : {}), ...(flightNatureRequiresExaminer(values.flightNature) ? { examiner: { name: values.examinerName.trim(), ...(values.examinerLicenceNumber.trim() ? { licenceNumber: values.examinerLicenceNumber.trim() } : {}) } } : {}), observations: values.observations.trim() };
    if (process.env.NODE_ENV === "development") console.debug("[OfficialAscensionForm] submit", { ascensionId, mode, isDirty: dirty, isValid: valid, isSubmitting: false });
    try {
      const succeeded = await onSubmit(input);
      if (succeeded !== false) setDirty(false);
    } finally {
      setIsSubmitting(false);
    }
  };
  const saveDisabled = !valid || isSubmitting || (mode === "EDIT" && (!hydrated || !dirty || !ascensionId));
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.debug("[OfficialAscensionForm] state", { ascensionId, mode, isDirty: dirty, isValid: valid, isSubmitting, disabled: saveDisabled });
  }, [ascensionId, dirty, isSubmitting, mode, saveDisabled, valid]);
  const moveToNextField = (event: KeyboardEvent<HTMLFormElement>) => { if (event.key !== "Enter" || event.shiftKey || event.target instanceof HTMLTextAreaElement) return; event.preventDefault(); const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])")]; const index = controls.indexOf(event.target as HTMLElement); controls[index + 1]?.focus(); };

  return <main className={styles.screen}><div className={styles.layout}>
    <button type="button" className={styles.backButton} onClick={() => onCancel(dirty)}><ChevronLeft size={18} aria-hidden="true" /> {backLabel}</button>
    <header className={styles.formHeader}><p className={styles.eyebrow}>Carnet officiel</p><h1 className={styles.title}>{title}</h1>{subtitle && <p className={styles.route}>{subtitle}</p>}{gpsDurationMinutes !== undefined && <p className={styles.gpsFact}>Temps GPS <strong>{gpsDurationMinutes} min</strong></p>}</header>
    <form id="official-ascension-form" className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }} onKeyDown={moveToNextField}>
      <label className={styles.wide}><span>Ballon</span><select value={selectedBalloonId || MANUAL_BALLOON_VALUE} onChange={(event) => chooseBalloon(event.target.value)}><option value={MANUAL_BALLOON_VALUE}>Aucun ballon enregistré</option>{balloons.map((balloon) => <option key={balloon.id} value={balloon.id}>{balloonDisplayName(balloon)}</option>)}<option value={ADD_BALLOON_VALUE}>Ajouter un ballon…</option></select></label>
      <label><span>Immatriculation</span><input value={values.registration} readOnly={Boolean(selectedBalloon)} onChange={(e) => update("registration", e.target.value.toUpperCase())} /></label>
      <label><span>Type de ballon</span><input value={values.balloonModel} readOnly={Boolean(selectedBalloon)} onChange={(e) => update("balloonModel", e.target.value)} /></label>
      <label><span>Date</span>{manualDateEntry ? <span className={styles.manualDateField}><span aria-hidden="true">{values.dateIso ? new Date(`${values.dateIso}T12:00:00`).toLocaleDateString("fr-FR") : "Choisir une date"}</span><input type="date" required autoComplete="off" value={values.dateIso} aria-label="Choisir la date de l’ascension" onChange={(e) => update("dateIso", e.target.value)} /></span> : <input type="date" required value={values.dateIso} aria-label="Date de l’ascension" onChange={(e) => update("dateIso", e.target.value)} />}</label>
      <label><span>Lieu d’envol</span><input value={values.departure} onChange={(e) => update("departure", e.target.value)} /></label>
      <label><span>Lieu d’atterrissage</span><input value={values.arrival} onChange={(e) => update("arrival", e.target.value)} /></label>
      <label><span>Catégorie</span><select value={values.category} onChange={(e) => update("category", e.target.value as typeof values.category)}><option value="">Sélectionner</option><option>Libre à air chaud</option><option>Libre à gaz</option></select></label>
      <label><span>Fonction</span><select value={values.pilotFunction} onChange={(e) => update("pilotFunction", e.target.value as typeof values.pilotFunction)}><option value="">Sélectionner</option><option>Pilote</option><option>Élève</option></select></label>
      <label className={styles.wide}><span>Nature du vol</span><select value={values.flightNature} onChange={(e) => update("flightNature", e.target.value as OfficialFlightNature)}><option value="STANDARD">Vol standard</option><option value="TRAINING_BPL">Vol d’entraînement BPL</option><option value="PROFICIENCY_CHECK_BPL">Contrôle de compétences BPL</option><option value="SKILL_TEST">Examen pratique</option><option value="COMMERCIAL_TRAINING">Formation commerciale</option><option value="COMMERCIAL_PROFICIENCY_CHECK">Contrôle de compétences commercial</option><option value="INSTRUCTION">Instruction</option></select></label>
      {flightNatureRequiresInstructor(values.flightNature) && <><label><span>FI(B) — Nom</span><input required value={values.instructorName} onChange={(e) => update("instructorName", e.target.value)} /></label><label><span>FI(B) — N° de licence <small>(facultatif)</small></span><input value={values.instructorLicenceNumber} onChange={(e) => update("instructorLicenceNumber", e.target.value)} /></label></>}
      {flightNatureRequiresExaminer(values.flightNature) && <><label><span>FE(B) — Nom</span><input required value={values.examinerName} onChange={(e) => update("examinerName", e.target.value)} /></label><label><span>FE(B) — N° de licence <small>(facultatif)</small></span><input value={values.examinerLicenceNumber} onChange={(e) => update("examinerLicenceNumber", e.target.value)} /></label></>}
      {values.flightNature !== "STANDARD" && <><label><span>Décollages <small>(facultatif)</small></span><input inputMode="numeric" pattern="[0-9]*" value={values.takeoffCount} onChange={(e) => update("takeoffCount", e.target.value.replace(/\D/g, ""))} /></label><label><span>Atterrissages <small>(facultatif)</small></span><input inputMode="numeric" pattern="[0-9]*" value={values.landingCount} onChange={(e) => update("landingCount", e.target.value.replace(/\D/g, ""))} /></label></>}
      <label><span>Temps officiel</span><span className={styles.suffixedInput}><input inputMode="numeric" pattern="[0-9]*" value={durationMinutes} onChange={(e) => { setDurationMinutes(e.target.value.replace(/\D/g, "")); setDirty(true); }} /><span>min</span></span></label>
      <label><span>Altitude atteinte <small>(facultatif)</small></span><span className={styles.suffixedInput}><input type="number" min="0" step="1" inputMode="numeric" value={values.maximumAltitudeM} onChange={(e) => update("maximumAltitudeM", e.target.value.replace(/\D/g, ""))} /><span>m</span></span></label>
      <label><span>Vol de nuit <small>(facultatif)</small></span><select value={values.nightFlight === true ? "yes" : values.nightFlight === false ? "no" : ""} onChange={(e) => update("nightFlight", e.target.value === "" ? null : e.target.value === "yes")}><option value="">Non renseigné</option><option value="no">Non</option><option value="yes">Oui</option></select></label>
      <label className={styles.wide}><span>Observations</span><textarea value={values.observations} onChange={(e) => update("observations", e.target.value)} /></label>
    </form>
    <div className={styles.formActions}><button type="button" onClick={() => onCancel(dirty)}>Annuler</button><button type={nativeSubmit ? "submit" : "button"} form={nativeSubmit ? "official-ascension-form" : undefined} disabled={saveDisabled} onClick={nativeSubmit ? undefined : () => void submit()}>{submitLabel}</button></div>
  </div></main>;
}
