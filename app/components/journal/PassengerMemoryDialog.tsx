"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { defaultPassengerMemoryBalloonId, passengerMemoryBalloonLabel, type PassengerMemoryBalloon } from "../../lib/passengerMemory";

type PassengerMemoryDialogProps = {
  defaultDuration: string;
  balloons: readonly PassengerMemoryBalloon[];
  activeBalloonId: string | null;
  onCancel: () => void;
  onCreate: (displayedDuration: string, balloonId: string) => Promise<void>;
};

export default function PassengerMemoryDialog({ defaultDuration, balloons, activeBalloonId, onCancel, onCreate }: PassengerMemoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [duration, setDuration] = useState(defaultDuration);
  const [balloonId, setBalloonId] = useState(() => defaultPassengerMemoryBalloonId(balloons, activeBalloonId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = duration.trim();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const create = async () => {
    if (!trimmed || !balloons.some(({ id }) => id === balloonId) || busy) return;
    setBusy(true); setError(null);
    try { await onCreate(trimmed, balloonId); }
    catch { setError("Le souvenir n’a pas pu être créé sur cet appareil."); setBusy(false); }
  };

  return <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-24px)] w-[min(92vw,420px)] overflow-y-auto rounded-[24px] border border-[var(--bc-border)] bg-[var(--bc-background-elevated)] p-5 text-[var(--bc-text-primary)] shadow-[var(--bc-shadow-high)] backdrop:bg-[rgb(3_10_19_/_78%)]" aria-labelledby="passenger-memory-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id="passenger-memory-title" className="text-xl font-semibold tracking-tight">Souvenir de votre vol</h2>
    <label className="mt-5 block"><span className="mb-2 block text-sm font-semibold text-[var(--bc-text-secondary)]">Ballon</span><select value={balloonId} disabled={busy || balloons.length === 0} onChange={(event) => setBalloonId(event.target.value)} className="min-h-12 w-full rounded-2xl border border-[var(--bc-border)] bg-[var(--bc-surface)] px-3 text-base font-semibold outline-none disabled:opacity-60"><option value="">Sélectionner un ballon</option>{balloons.map((balloon) => <option key={balloon.id} value={balloon.id}>{passengerMemoryBalloonLabel(balloon) ?? balloon.id}</option>)}</select></label>
    {balloons.length === 0 && <p className="mt-2 text-sm leading-relaxed text-[var(--bc-text-muted)]">Aucun ballon n’est enregistré. <Link href="/more/profile/balloons" className="font-semibold text-[var(--bc-accent)] underline">Aller à Mes ballons</Link>.</p>}
    <label className="mt-5 block"><span className="mb-2 block text-sm font-semibold text-[var(--bc-text-secondary)]">Durée du vol</span><input ref={inputRef} value={duration} maxLength={24} disabled={busy} onChange={(event) => setDuration(event.target.value)} className="min-h-12 w-full rounded-2xl border border-[var(--bc-border)] bg-[var(--bc-surface)] px-3 text-base font-semibold outline-none disabled:opacity-60" /></label>
    <p className="mt-2 text-xs leading-relaxed text-[var(--bc-text-muted)]">Cette valeur apparaît uniquement sur le souvenir et ne modifie pas le vol enregistré.</p>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--bc-danger)]">{error}</p>}
    <div className="sticky bottom-0 mt-5 grid grid-cols-2 gap-2 bg-[var(--bc-background-elevated)] pt-2" style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}>
      <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 rounded-full border border-[var(--bc-border)] bg-[var(--bc-surface)] px-4 text-sm font-semibold disabled:opacity-45">Annuler</button>
      <button type="button" disabled={!trimmed || !balloons.some(({ id }) => id === balloonId) || busy} onClick={() => void create()} className="min-h-12 rounded-full bg-[var(--bc-accent)] px-4 text-sm font-semibold text-[var(--bc-accent-foreground)] disabled:opacity-45">{busy ? "Création…" : "Créer le souvenir"}</button>
    </div>
  </dialog>;
}
