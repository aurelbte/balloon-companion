"use client";

import { useEffect, useRef } from "react";
import type { JournalFlight } from "../../lib/journalMockData";

type DeleteFlightDialogProps = {
  flight: JournalFlight;
  returnFocusTo: HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteFlightDialog({
  flight,
  returnFocusTo,
  onCancel,
  onConfirm,
}: DeleteFlightDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-[min(92vw,420px)] rounded-[24px] border border-[var(--bc-border)] bg-[var(--bc-background-elevated)] p-5 text-[var(--bc-text-primary)] shadow-[var(--bc-shadow-high)] backdrop:bg-[rgb(3_10_19_/_78%)]"
      aria-labelledby="delete-flight-title"
      aria-describedby="delete-flight-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="delete-flight-title" className="text-xl font-semibold tracking-tight">
        Supprimer ce vol ?
      </h2>
      <p
        id="delete-flight-description"
        className="mt-2 text-sm leading-relaxed text-[var(--bc-text-secondary)]"
      >
        Le vol {flight.departure} → {flight.arrival} et ses données seront
        définitivement supprimés.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="min-h-12 rounded-full border border-[var(--bc-border)] bg-[var(--bc-surface)] px-4 text-sm font-semibold"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-12 rounded-full bg-[color-mix(in_srgb,var(--bc-danger)_72%,var(--bc-surface))] px-4 text-sm font-semibold text-white"
        >
          Supprimer
        </button>
      </div>
    </dialog>
  );
}
