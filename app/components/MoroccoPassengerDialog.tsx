"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { emptyMoroccoPassengers, moroccoPassengerWeight, prepareMoroccoPassengers, type MoroccoPassenger, type MoroccoPassengerSex } from "../lib/moroccoPassengers";

type Props = { date: string; onCancel: () => void; onExport: (passengers: readonly MoroccoPassenger[]) => void };
export default function MoroccoPassengerDialog({ date, onCancel, onExport }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [rows, setRows] = useState(emptyMoroccoPassengers);
  const [weightDrafts, setWeightDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const update = (index: number, patch: Partial<MoroccoPassenger>) => {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setError(null);
  };
  const weight = (row: MoroccoPassenger) => moroccoPassengerWeight(row.sex, row.customWeightKg);
  const invalidWeight = rows.some(row => weight(row) !== null && (!Number.isFinite(weight(row)) || weight(row)! <= 0));
  const total = invalidWeight ? null : rows.reduce((sum, row) => sum + (weight(row) ?? 0), 0);
  const resetWeight = (index: number) => {
    setWeightDrafts(current => { const next = { ...current }; delete next[index]; return next; });
    update(index, { customWeightKg: undefined });
  };
  const count = rows.filter(row => row.sex !== "").length;
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onCancel(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-[var(--bc-color-canvas)] p-0 text-[var(--bc-color-text)] backdrop:bg-black/60 sm:m-auto sm:h-auto sm:max-h-[92dvh] sm:w-[min(960px,96vw)] sm:rounded-2xl">
    <form className="flex max-h-dvh flex-col sm:max-h-[92dvh]" onSubmit={event => {
      event.preventDefault();
      try { prepareMoroccoPassengers(rows); onExport(rows); } catch (cause) { setError(cause instanceof Error ? cause.message : "Listing invalide."); }
    }}>
      <header className="shrink-0 border-b px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3"><h2 id={titleId} className="text-base font-semibold">Maroc · liste des passagers</h2><button type="button" onClick={onCancel} className="min-h-11 rounded-lg px-3">Annuler</button></div>
        <p className="text-sm">Date du dossier : {date}</p>
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
              }} onBlur={() => { if (weightDrafts[index]?.trim() === "") resetWeight(index); }} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label><button type="button" onClick={() => resetWeight(index)} className="min-h-11 px-2 underline" aria-label={`Rétablir le poids automatique du passager ${index + 1}`}>Auto</button></div>
            </div>
          </fieldset>)}
        </div>
      </div>
      <footer className="shrink-0 border-t px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <p aria-live="polite" className="text-sm font-semibold">{count} passager{count > 1 ? "s" : ""} · {total === null ? "Poids à vérifier" : `${total.toLocaleString("fr-FR")} kg`}</p>
        <p className="mt-1 text-xs">Champs modifiables dans le PDF. Le poids reste inchangé si vous y modifiez le sexe ; il reste modifiable manuellement. Saisie conservée uniquement pendant cette fenêtre, sans synchronisation.</p>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <button type="submit" className="mt-3 min-h-12 w-full rounded-xl bg-[var(--bc-accent)] px-4 font-semibold text-[var(--bc-accent-foreground)]">Exporter le dossier Maroc</button>
      </footer>
    </form>
  </dialog>, document.body);
}
