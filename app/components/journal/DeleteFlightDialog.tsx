"use client";

import { useEffect, useRef } from "react";
type DeleteFlightDialogProps = {
  flightName: string;
  entityLabel?: "vol" | "ascension";
  linkedAscension?: boolean;
  returnFocusTo: HTMLElement | null;
  onCancel: () => void;
  onConfirm: (removeLinkedAscension?: boolean) => void;
};

export default function DeleteFlightDialog({
  flightName,
  entityLabel = "vol",
  linkedAscension = false,
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
        Supprimer {entityLabel === "ascension" ? "cette ascension" : "ce vol"} ?
      </h2>
      <p
        id="delete-flight-description"
        className="mt-2 text-sm leading-relaxed text-[var(--bc-text-secondary)]"
      >
        <span className="sr-only">Élément concerné : {flightName}. </span>
        {entityLabel === "ascension" ? "Cette ascension sera retirée de votre Carnet." : "Ce vol et sa trace seront supprimés du Journal."}
        {entityLabel === "ascension" && linkedAscension && " Le vol enregistré et sa trace resteront dans le Journal."}
        {entityLabel === "vol" && linkedAscension && " Une ascension officielle est liée : choisissez explicitement de la conserver ou de la supprimer."}
      </p>
      <div className={`mt-5 grid gap-2 ${linkedAscension && entityLabel === "vol" ? "grid-cols-1" : "grid-cols-2"}`}>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="min-h-12 rounded-full border border-[var(--bc-border)] bg-[var(--bc-surface)] px-4 text-sm font-semibold"
        >
          Annuler
        </button>
        {linkedAscension && entityLabel === "vol" && <button
          type="button"
          onClick={() => onConfirm(false)}
          className="min-h-12 rounded-full border border-[var(--bc-border)] bg-[var(--bc-surface)] px-4 text-sm font-semibold"
        >
          Supprimer le vol uniquement
        </button>}
        <button
          type="button"
          onClick={() => onConfirm(linkedAscension)}
          className="min-h-12 rounded-full bg-[color-mix(in_srgb,var(--bc-danger)_72%,var(--bc-surface))] px-4 text-sm font-semibold text-white"
        >
          {linkedAscension && entityLabel === "vol" ? "Supprimer le vol et l’ascension" : "Supprimer"}
        </button>
      </div>
    </dialog>
  );
}
