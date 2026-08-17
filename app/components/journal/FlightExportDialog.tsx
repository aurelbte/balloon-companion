"use client";

import { useEffect, useRef, useState } from "react";
import { Database, MapPinned, X } from "lucide-react";

type FlightExportDialogProps = {
  onClose: () => void;
  onExportGpx: () => Promise<void>;
  onExportBcFlight: () => Promise<void>;
};

export default function FlightExportDialog({ onClose, onExportGpx, onExportBcFlight }: FlightExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<"gpx" | "bcflight" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const run = async (kind: "gpx" | "bcflight", action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await action();
      onClose();
    } catch {
      setError("Impossible de préparer ce fichier sur cet appareil.");
      setBusy(null);
    }
  };

  return <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-24px)] w-[min(92vw,440px)] overflow-y-auto rounded-[24px] border border-[var(--bc-border)] bg-[var(--bc-background-elevated)] p-5 text-[var(--bc-text-primary)] shadow-[var(--bc-shadow-high)] backdrop:bg-[rgb(3_10_19_/_78%)]" aria-labelledby="flight-export-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="flex items-center justify-between gap-3">
      <h2 id="flight-export-title" className="text-xl font-semibold tracking-tight">Exporter le vol</h2>
      <button ref={closeRef} type="button" disabled={Boolean(busy)} onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-[var(--bc-border)] bg-[var(--bc-surface)] disabled:opacity-45" aria-label="Fermer"><X size={18} /></button>
    </div>
    <div className="mt-4 grid gap-3">
      <button type="button" disabled className="min-h-[92px] rounded-[20px] border border-[var(--bc-border)] bg-[var(--bc-surface)] p-4 text-left opacity-60" aria-describedby="passenger-memory-status">
        <strong className="block text-sm font-semibold">🎈 Souvenir passagers</strong>
        <span className="mt-1 block text-xs text-[var(--bc-text-secondary)]">PDF de votre vol à partager</span>
        <span id="passenger-memory-status" className="mt-2 block text-xs font-semibold text-[var(--bc-accent)]">Bientôt disponible</span>
      </button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void run("gpx", onExportGpx)} className="flex min-h-[92px] items-center gap-4 rounded-[20px] border border-[var(--bc-border)] bg-[var(--bc-surface)] p-4 text-left disabled:opacity-45">
        <MapPinned size={24} aria-hidden="true" className="shrink-0 text-[var(--bc-accent)]" />
        <span><strong className="block text-sm font-semibold">Trace GPX</strong><span className="mt-1 block text-xs text-[var(--bc-text-secondary)]">{busy === "gpx" ? "Préparation…" : "Trajectoire compatible avec d’autres applications"}</span></span>
      </button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void run("bcflight", onExportBcFlight)} className="flex min-h-[92px] items-center gap-4 rounded-[20px] border border-[var(--bc-border)] bg-[var(--bc-surface)] p-4 text-left disabled:opacity-45">
        <Database size={24} aria-hidden="true" className="shrink-0 text-[var(--bc-accent)]" />
        <span><strong className="block text-sm font-semibold">Fichier Balloon Companion</strong><span className="mt-1 block text-xs text-[var(--bc-text-secondary)]">{busy === "bcflight" ? "Préparation…" : "Sauvegarde complète du vol"}</span></span>
      </button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-[var(--bc-danger)]">{error}</p>}
  </dialog>;
}
