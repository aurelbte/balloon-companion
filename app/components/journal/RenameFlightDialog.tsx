"use client";

import { useEffect, useRef, useState } from "react";
import type { JournalFlight } from "../../lib/journalMockData";

type RenameFlightDialogProps = {
  flight: JournalFlight;
  initialName: string;
  returnFocusTo: HTMLElement | null;
  onCancel: () => void;
  onConfirm: (name: string) => void;
};

export default function RenameFlightDialog({
  flight,
  initialName,
  returnFocusTo,
  onCancel,
  onConfirm,
}: RenameFlightDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initialName);
  const trimmedName = name.trim();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (dialog.open) dialog.close();
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[min(92vw,420px)] rounded-[24px] border border-[var(--bc-border)] bg-[var(--bc-background-elevated)] p-5 text-[var(--bc-text-primary)] shadow-[var(--bc-shadow-high)] backdrop:bg-[rgb(3_10_19_/_78%)]"
      aria-labelledby="rename-flight-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="rename-flight-title" className="text-xl font-semibold tracking-tight">Modifier le vol</h2>
      <label className="mt-4 block">
        <span className="sr-only">Nouveau nom du vol {flight.departure} vers {flight.arrival}</span>
        <input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} className="min-h-12 w-full rounded-2xl border border-[var(--bc-border)] bg-[var(--bc-surface)] px-3 text-base font-semibold outline-none" />
      </label>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-full border border-[var(--bc-border)] bg-[var(--bc-surface)] px-4 text-sm font-semibold">Annuler</button>
        <button type="button" disabled={!trimmedName} onClick={() => onConfirm(trimmedName)} className="min-h-12 rounded-full bg-[var(--bc-accent)] px-4 text-sm font-semibold text-[var(--bc-accent-foreground)] disabled:opacity-45">Enregistrer</button>
      </div>
    </dialog>
  );
}
