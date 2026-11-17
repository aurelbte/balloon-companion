"use client";
import { useEffect, useId, useRef, useState } from "react";
import { resolveMoroccoDossierReference, type MoroccoDossierReference, type ResolvedMoroccoDossierReference } from "../lib/moroccoDossierReference";
import { createPortal } from "react-dom";
import { emptyMoroccoPassengers, moroccoPassengerWeight, prepareMoroccoPassengers, type MoroccoPassenger, type MoroccoPassengerSex } from "../lib/moroccoPassengers";

import { applyMoroccoDossierLoading, calculateMoroccoLoading, MOROCCO_LOADING_DEFAULTS, parseMoroccoMass, readMoroccoPassengerDraft, saveMoroccoPassengerDraft, type MoroccoDossierLoading } from "../lib/moroccoDossierLoading";
import type { DossierPdfInput } from "../lib/flightDossierPdf";
import type { LoadCalculationInput } from "../lib/loadPerformance/types";

type Props = { dossier?: DossierPdfInput["dossier"]; loadInput?: LoadCalculationInput; draftKey?: string; reference: ResolvedMoroccoDossierReference; onCancel: () => void; onExport: (passengers: readonly MoroccoPassenger[], reference: MoroccoDossierReference, loading: MoroccoDossierLoading) => void };
export default function MoroccoPassengerDialog({ reference, onCancel, onExport, dossier, loadInput, draftKey }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [restored] = useState(() => draftKey ? readMoroccoPassengerDraft(draftKey) : null);
  const [pilot, setPilot] = useState(restored?.pilot ?? String(MOROCCO_LOADING_DEFAULTS.pilotKg));
  const [equipment, setEquipment] = useState(restored?.equipment ?? String(MOROCCO_LOADING_DEFAULTS.equipmentKg));
  const [draftSaved, setDraftSaved] = useState(true);
  const [referenceDate, setReferenceDate] = useState(restored?.date ?? reference.date);
  const [referenceTime, setReferenceTime] = useState(restored?.time ?? reference.time);
  const [rows, setRows] = useState(() => restored?.rows ?? emptyMoroccoPassengers());
  const [weightDrafts, setWeightDrafts] = useState<Record<number, string>>(restored?.weightDrafts ?? {});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const update = (index: number, patch: Partial<MoroccoPassenger>) => {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setError(null);
  };
  useEffect(() => {
    if (draftKey) setDraftSaved(saveMoroccoPassengerDraft(draftKey, { rows, weightDrafts, pilot, equipment, date: referenceDate, time: referenceTime }));
  }, [draftKey, rows, weightDrafts, pilot, equipment, referenceDate, referenceTime]);
  const weight = (row: MoroccoPassenger) => moroccoPassengerWeight(row.sex, row.customWeightKg);
  const resetWeight = (index: number) => {
    setWeightDrafts(current => { const next = { ...current }; delete next[index]; return next; });
    update(index, { customWeightKg: undefined });
  };
  const count = rows.filter(row => row.sex !== "").length;
  const loading = { pilotKg: parseMoroccoMass(pilot), equipmentKg: parseMoroccoMass(equipment), passengerCount: count };
  let summary: ReturnType<typeof calculateMoroccoLoading> | null = null;
  let preview: DossierPdfInput["dossier"]["operations"] | undefined;
  let validationError: string | null = null;
  try {
    summary = calculateMoroccoLoading(rows, loading);
    if (dossier) preview = applyMoroccoDossierLoading({ dossier, weather: null, passengers: rows, loading, loadInput }).dossier.operations;
  } catch (cause) { validationError = cause instanceof Error ? cause.message : "Chargement invalide."; }
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onCancel(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-[var(--bc-color-canvas)] p-0 text-[var(--bc-color-text)] backdrop:bg-black/60 sm:m-auto sm:h-auto sm:max-h-[92dvh] sm:w-[min(960px,96vw)] sm:rounded-2xl">
    <form className="flex max-h-dvh flex-col sm:max-h-[92dvh]" onSubmit={event => {
      event.preventDefault();
      try { const editedReference = { date: referenceDate, time: referenceTime }; resolveMoroccoDossierReference({ startedAt: reference.iso, launchTimeZone: reference.timeZone }, editedReference); prepareMoroccoPassengers(rows); calculateMoroccoLoading(rows, loading); if (validationError) throw new Error(validationError); onExport(rows, editedReference, loading); } catch (cause) { setError(cause instanceof Error ? cause.message : "Listing invalide."); }
    }}>
      <header className="shrink-0 border-b px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3"><h2 id={titleId} className="text-base font-semibold">Maroc · liste des passagers</h2><button type="button" onClick={onCancel} className="min-h-11 rounded-lg px-3">Annuler</button></div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs">Date du dossier<input type="date" required value={referenceDate} onChange={event => { setReferenceDate(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
          <label className="min-w-0 text-xs">Heure du dossier<input type="time" required step="60" value={referenceTime} onChange={event => { setReferenceTime(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="text-xs">Pilote (kg)<input aria-label="Pilote (kg)" type="number" min="0.01" step="any" required value={pilot} onChange={event => { setPilot(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
          <label className="text-xs">Équipement (kg)<input aria-label="Équipement (kg)" type="number" min="0" step="any" required value={equipment} onChange={event => { setEquipment(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
        </div>
        <p className="mt-1 text-xs">Équipement additionnel uniquement : ne pas reprendre les masses déjà comprises dans le ballon équipé.</p>
        <p className="mt-1 text-xs">Heure locale du vol : {reference.timeZone}. Cette référence ne déplace pas les horaires des données météo ou du vol.</p>
        {reference.warning && <p role="status" className="mt-1 text-xs">{reference.warning}</p>}
        <p className="mt-1 text-xs">13 places · valeurs par défaut H : 92 kg, F : 74 kg, E : 35 kg. Poids modifiables ; « Auto » rétablit le barème. Laissez les places inutilisées vides.</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((row, index) => <fieldset key={index} className="min-w-0 rounded-xl border p-3">
            <legend className="px-1 text-sm font-semibold">Passager {index + 1}</legend>
            <div className="grid grid-cols-2 gap-2">
              {([ ["lastName", "Nom"], ["firstName", "Prénom"], ["nationality", "Nationalité"] ] as const).map(([key, label]) => <label key={key} className={`min-w-0 text-xs ${key === "nationality" ? "col-span-2" : ""}`}>{label}<input autoFocus={index === 0 && key === "lastName"} type="text" autoComplete="off" value={row[key]} onChange={event => update(index, { [key]: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>)}
              <label className="min-w-0 text-xs">Sexe<select value={row.sex} onChange={event => update(index, { sex: event.target.value as MoroccoPassengerSex })} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base"><option value="">—</option>{["H", "F", "E"].map(sex => <option key={sex}>{sex}</option>)}</select></label>
              <div className="min-w-0 text-xs"><label>Poids (kg)<input type="text" inputMode="decimal" aria-invalid={row.customWeightKg !== undefined && (!Number.isFinite(row.customWeightKg) || row.customWeightKg <= 0)} value={weightDrafts[index] ?? (weight(row) === null ? "" : String(weight(row)))} onChange={event => {
                const raw = event.target.value;
                setWeightDrafts(current => ({ ...current, [index]: raw }));
                const normalized = raw.trim().replace(",", ".");
                update(index, { customWeightKg: /^\d+(?:\.\d*)?$/.test(normalized) ? Number(normalized) : NaN });
              }}  className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label><button type="button" onClick={() => resetWeight(index)} className="min-h-11 px-2 underline" aria-label={`Rétablir le poids automatique du passager ${index + 1}`}>Auto</button></div>
            </div>
            <button type="button" className="mt-1 min-h-11 px-2 text-xs underline" aria-label={`Retirer le passager ${index + 1}`} onClick={() => {
              setWeightDrafts(current => { const next = { ...current }; delete next[index]; return next; });
              update(index, { lastName: "", firstName: "", nationality: "", sex: "", customWeightKg: undefined });
            }}>Retirer ce passager</button>
          </fieldset>)}
        </div>
      </div>
      <footer className="shrink-0 border-t px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <p aria-live="polite" className="text-sm font-semibold">{count} passager{count > 1 ? "s" : ""} · {summary === null ? "Poids à vérifier" : `${summary.passengersKg.toLocaleString("fr-FR")} kg de passagers`}</p>
        {summary && <p className="mt-1 text-xs">Chargement : {summary.passengersKg.toLocaleString("fr-FR")} + {summary.pilotKg.toLocaleString("fr-FR")} + {summary.equipmentKg.toLocaleString("fr-FR")} = {summary.loadingKg.toLocaleString("fr-FR")} kg.</p>}
        {preview && <p aria-live="polite" className="mt-1 text-xs">Masse prévue : {preview.load.plannedMassKg?.toLocaleString("fr-FR") ?? "Non disponible"} kg · Marge : {preview.load.signedMarginKg ?? "Non disponible"}. {preview.load.status === "AVAILABLE" && preview.load.calculationStatus !== "OFFICIAL_VALIDATED" ? "Estimation non validée. " : ""}{preview.load.message} La courbe constructeur du PDF conserve ses conditions de disponibilité.</p>}
        <p className="mt-1 text-xs">Champs modifiables dans le PDF. Le poids reste inchangé si vous y modifiez le sexe ; il reste modifiable manuellement. Saisie conservée dans cette session sur cet appareil, sans synchronisation.</p>
        {!draftSaved && <p role="status" className="mt-1 text-xs">Stockage local indisponible : conservez cette fenêtre ouverte pour garder la saisie.</p>}
        {(error || validationError) && <p role="alert" className="mt-2 text-sm text-red-600">{error || validationError}</p>}
        <button type="submit" className="mt-3 min-h-12 w-full rounded-xl bg-[var(--bc-accent)] px-4 font-semibold text-[var(--bc-accent-foreground)]">Exporter le dossier Maroc</button>
      </footer>
    </form>
  </dialog>, document.body);
}
