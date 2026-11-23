"use client";
import { useEffect, useId, useRef, useState } from "react";
import { resolveMoroccoDossierReference, type MoroccoDossierReference, type ResolvedMoroccoDossierReference } from "../lib/moroccoDossierReference";
import { createPortal } from "react-dom";
import { emptyMoroccoPassengers, moroccoPassengerWeight, prepareMoroccoPassengers, type MoroccoPassenger, type MoroccoPassengerSex } from "../lib/moroccoPassengers";

import { applyMoroccoDossierLoading, calculateMoroccoLoading, calculateMoroccoLandingMass, moroccoDefaultGasConsumption, moroccoChargeAltitudeAmsl, moroccoProjectedAltitudeAmsl, MOROCCO_LOADING_DEFAULTS, parseMoroccoMass, readMoroccoPassengerDraft, saveMoroccoPassengerDraft, type MoroccoDossierLoading } from "../lib/moroccoDossierLoading";
import { moroccoLandingMassConfigurationKey, moroccoMinimumLandingMass, type MoroccoLandingMassApplicability } from "../lib/moroccoMinimumLandingMass";
import type { DossierPdfInput } from "../lib/flightDossierPdf";
import type { LoadCalculationInput } from "../lib/loadPerformance/types";

type Props = { dossier?: DossierPdfInput["dossier"]; loadInput?: LoadCalculationInput; canonicalAltitudeAmslM?: number | null; onAltitudeChange?: (altitudeAmslM: number) => void; draftKey?: string; reference: ResolvedMoroccoDossierReference; onCancel: () => void; onExport: (passengers: readonly MoroccoPassenger[], reference: MoroccoDossierReference, loading: MoroccoDossierLoading, applicability?: MoroccoLandingMassApplicability, altitudeAmslM?: number) => void };
export default function MoroccoPassengerDialog({ reference, onCancel, onExport, dossier, loadInput, canonicalAltitudeAmslM, onAltitudeChange, draftKey }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [restored] = useState(() => draftKey ? readMoroccoPassengerDraft(draftKey) : null);
  const [pilot, setPilot] = useState(restored?.pilot ?? String(MOROCCO_LOADING_DEFAULTS.pilotKg));
  const [equipment, setEquipment] = useState(restored?.equipment ?? String(MOROCCO_LOADING_DEFAULTS.equipmentKg));
  const configurationKey = dossier ? moroccoLandingMassConfigurationKey(dossier.balloon) : "";
  const [gas, setGas] = useState(restored?.gas ?? (dossier ? String(moroccoDefaultGasConsumption(dossier.balloon) ?? "") : ""));
  // Keep the exact editing string, including a trailing decimal separator, until validation.
  const [altitudeDraft, setAltitudeDraft] = useState<string | null>(null);
  const canonicalAltitude = moroccoChargeAltitudeAmsl(loadInput, canonicalAltitudeAmslM, dossier?.operations?.load.plannedMaximumAltitudeMslM);
  const altitude = altitudeDraft ?? (canonicalAltitude === null ? "" : String(canonicalAltitude));
  // Reuse only an already established, still applicable review. No new proof is created by this dialog.
  const existingProof = restored?.minimumLandingMassApplicability;
  const applicability = dossier && existingProof && moroccoMinimumLandingMass(dossier.balloon, existingProof).kg !== null ? existingProof : undefined;
  const minimum = dossier ? moroccoMinimumLandingMass(dossier.balloon, applicability) : null;
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
    if (draftKey) setDraftSaved(saveMoroccoPassengerDraft(draftKey, { ...restored, rows, weightDrafts, pilot, equipment, gas, configurationKey, minimumLandingMassApplicability: applicability, date: referenceDate, time: referenceTime }));
  }, [draftKey, restored, rows, weightDrafts, pilot, equipment, gas, configurationKey, applicability, referenceDate, referenceTime]);
  const validateAltitude = () => {
    const value = moroccoProjectedAltitudeAmsl(altitude, "AMSL", loadInput?.launchElevationMslM);
    if (altitudeDraft !== null || value !== loadInput?.plannedMaximumAltitudeMslM) {
      if (!onAltitudeChange) throw new Error("Synchronisation de l’altitude indisponible.");
      onAltitudeChange(value);
      setAltitudeDraft(null);
    }
    return value;
  };
  const weight = (row: MoroccoPassenger) => moroccoPassengerWeight(row.sex, row.customWeightKg);
  const resetWeight = (index: number) => {
    setWeightDrafts(current => { const next = { ...current }; delete next[index]; return next; });
    update(index, { customWeightKg: undefined });
  };
  const count = rows.filter(row => row.sex !== "").length;
  const loading: MoroccoDossierLoading = { pilotKg: parseMoroccoMass(pilot), equipmentKg: parseMoroccoMass(equipment), passengerCount: count,
    ...(gas.trim() ? { expectedGasConsumptionKg: parseMoroccoMass(gas) } : {}) };
  let summary: ReturnType<typeof calculateMoroccoLoading> | null = null;
  let preview: DossierPdfInput["dossier"]["operations"] | undefined;
  let landingPreview: ReturnType<typeof calculateMoroccoLandingMass> | undefined;
  let validationError: string | null = null;
  try {
    summary = calculateMoroccoLoading(rows, loading);
    let previewAltitude: number | undefined;
    try { previewAltitude = moroccoProjectedAltitudeAmsl(altitude, "AMSL", loadInput?.launchElevationMslM); }
    catch (cause) { validationError = cause instanceof Error ? cause.message : "Altitude invalide."; }
    if (dossier) {
      const prepared = applyMoroccoDossierLoading({ dossier, weather: null, passengers: rows, loading, loadInput: loadInput ? { ...loadInput, plannedMaximumAltitudeMslM: previewAltitude } : undefined, minimumLandingMassApplicability: applicability });
      preview = prepared.dossier.operations;
      landingPreview = calculateMoroccoLandingMass(prepared);
    }
  } catch (cause) { validationError = cause instanceof Error ? cause.message : "Chargement invalide."; }
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onCancel(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-[var(--bc-color-canvas)] p-0 text-[var(--bc-color-text)] backdrop:bg-black/60 sm:m-auto sm:h-auto sm:max-h-[92dvh] sm:w-[min(960px,96vw)] sm:rounded-2xl">
    <form className="flex max-h-dvh flex-col sm:max-h-[92dvh]" onSubmit={event => {
      event.preventDefault();
      try { const editedReference = { date: referenceDate, time: referenceTime }; resolveMoroccoDossierReference({ startedAt: reference.iso, launchTimeZone: reference.timeZone }, editedReference); prepareMoroccoPassengers(rows); calculateMoroccoLoading(rows, loading); if (validationError) throw new Error(validationError); const validatedAltitude = validateAltitude(); onExport(rows, editedReference, loading, applicability, validatedAltitude); } catch (cause) { setError(cause instanceof Error ? cause.message : "Listing invalide."); }
    }}>
      <header className="shrink-0 border-b px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3"><h2 id={titleId} className="text-base font-semibold">Maroc · liste des passagers</h2><button type="button" onClick={onCancel} className="min-h-11 rounded-lg px-3">Annuler</button></div>
        <details className="mt-1 text-xs"><summary className="min-h-11 cursor-pointer py-3">Dossier : {referenceDate} · {referenceTime} ({reference.timeZone})</summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs">Date du dossier<input type="date" required value={referenceDate} onChange={event => { setReferenceDate(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
          <label className="min-w-0 text-xs">Heure du dossier<input type="time" required step="60" value={referenceTime} onChange={event => { setReferenceTime(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
        </div>
        <p className="mt-1 text-xs">Heure locale : {reference.timeZone}. Les horaires météo et du vol ne changent pas.</p>
        </details>
        {reference.warning && <p role="status" className="mt-1 text-xs">{reference.warning}</p>}
        <p className="mt-1 text-xs">13 places · poids modifiables · laissez les places inutilisées vides.</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="min-w-0 text-xs">Pilote (kg)<input aria-label="Pilote (kg)" type="number" min="0.01" step="any" required value={pilot} onChange={event => { setPilot(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
          <label className="min-w-0 text-xs">Équipement (kg)<input aria-label="Équipement (kg)" type="number" min="0" step="any" required value={equipment} onChange={event => { setEquipment(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
          <label className="min-w-0 text-xs">Gaz consommé prévu (kg)<input aria-label="Gaz consommé prévu (kg)" type="number" min="0" step="any" value={gas} onChange={event => { setGas(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
          <label className="min-w-0 text-xs">Altitude de vol projetée (m AMSL)<input aria-label="Altitude de vol projetée (m AMSL)" type="text" inputMode="decimal" required value={altitude} onChange={event => {
            setAltitudeDraft(event.target.value); setError(null);
          }} onBlur={() => { try { validateAltitude(); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Altitude invalide."); } }} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>
          {altitudeDraft !== null && <p className="col-span-2 text-xs">Altitude en cours d’édition : aperçu de charge provisoire. Validation à la sortie du champ ou à l’export, en mètres AMSL.</p>}
          <p className="col-span-2 text-xs">Équipement additionnel uniquement. Altitude en mètres AMSL, synchronisée avec la préparation à la validation.</p>
          {dossier && moroccoDefaultGasConsumption(dossier.balloon) !== undefined && <p className="col-span-2 text-xs">CN-CBN / Z-275 : 70 kg proposés par le pilote, modifiables.</p>}
          <div aria-live="polite" className="col-span-2 rounded-lg border p-3 text-xs">
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              <dt>Masse au décollage</dt><dd>{preview?.load.plannedMassKg == null ? "Non disponible" : `${preview.load.plannedMassKg.toLocaleString("fr-FR")} kg`}</dd>
              <dt>Gaz consommé prévu</dt><dd>{loading.expectedGasConsumptionKg !== undefined && Number.isFinite(loading.expectedGasConsumptionKg) ? `${loading.expectedGasConsumptionKg.toLocaleString("fr-FR")} kg` : "Non renseigné"}</dd>
              <dt>Masse estimée à l’atterrissage</dt><dd>{landingPreview?.landingKg === null || landingPreview?.landingKg === undefined ? "Non disponible" : `${landingPreview.landingKg.toLocaleString("fr-FR")} kg`}</dd>
            </dl>
            {landingPreview && <p className="mt-2">{landingPreview.notice}</p>}
            <p className="mt-2">{minimum?.kg == null ? "Minimum constructeur à vérifier" : `Minimum constructeur : ${minimum.kg.toLocaleString("fr-FR")} kg`}</p>
          </div>
        </div>
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
        <p className="mt-1 text-xs">Saisie conservée sur cet appareil pendant cette session. PDF modifiable, sans recalcul.</p>
        {!draftSaved && <p role="status" className="mt-1 text-xs">Stockage local indisponible : conservez cette fenêtre ouverte pour garder la saisie.</p>}
        {(error || validationError) && <p role="alert" className="mt-2 text-sm text-red-600">{error || validationError}</p>}
        <button type="submit" className="mt-3 min-h-12 w-full rounded-xl bg-[var(--bc-accent)] px-4 font-semibold text-[var(--bc-accent-foreground)]">Exporter le dossier Maroc</button>
      </footer>
    </form>
  </dialog>, document.body);
}
