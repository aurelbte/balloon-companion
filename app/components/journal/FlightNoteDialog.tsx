"use client";

import { useEffect, useRef, useState } from "react";

type FlightNoteDialogProps = {
  initialNote: string;
  onCancel: () => void;
  onSave: (note: string | null) => Promise<void>;
};

export default function FlightNoteDialog({ initialNote, onCancel, onSave }: FlightNoteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(initialNote.length, initialNote.length);
    return () => { if (dialog.open) dialog.close(); };
  }, [initialNote]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(note.trim() || null);
    } catch {
      setError("La note n’a pas pu être enregistrée sur cet appareil.");
      setSaving(false);
    }
  };

  return <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-24px)] w-[min(92vw,420px)] overflow-y-auto rounded-[24px] border border-[var(--bc-border)] bg-[var(--bc-background-elevated)] p-5 text-[var(--bc-text-primary)] shadow-[var(--bc-shadow-high)] backdrop:bg-[rgb(3_10_19_/_78%)]" aria-labelledby="flight-note-title" onCancel={(event) => { event.preventDefault(); if (!saving) onCancel(); }}>
    <h2 id="flight-note-title" className="text-xl font-semibold tracking-tight">Note de vol</h2>
    <label className="mt-4 block">
      <span className="sr-only">Note libre associée au vol</span>
      <textarea ref={textareaRef} rows={7} maxLength={4000} value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} className="w-full resize-y rounded-2xl border border-[var(--bc-border)] bg-[var(--bc-surface)] p-3 text-base leading-relaxed outline-none disabled:opacity-60" />
    </label>
    {error && <p role="alert" className="mt-2 text-sm text-[var(--bc-danger)]">{error}</p>}
    <div className="sticky bottom-0 mt-4 grid grid-cols-2 gap-2 bg-[var(--bc-background-elevated)] pt-2" style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}>
      <button type="button" disabled={saving} onClick={onCancel} className="min-h-12 rounded-full border border-[var(--bc-border)] bg-[var(--bc-surface)] px-4 text-sm font-semibold disabled:opacity-45">Annuler</button>
      <button type="button" disabled={saving} onClick={() => void save()} className="min-h-12 rounded-full bg-[var(--bc-accent)] px-4 text-sm font-semibold text-[var(--bc-accent-foreground)] disabled:opacity-45">{saving ? "Enregistrement…" : "Enregistrer"}</button>
    </div>
  </dialog>;
}
