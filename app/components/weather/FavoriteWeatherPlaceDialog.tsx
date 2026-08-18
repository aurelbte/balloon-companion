"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GeocodingResult } from "../../lib/trajectory/integration";

export default function FavoriteWeatherPlaceDialog({ onCancel, onSelect }: { onCancel: () => void; onSelect: (place: GeocodingResult) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { const dialog = dialogRef.current; if (!dialog) return; dialog.showModal(); inputRef.current?.focus(); return () => { if (dialog.open) dialog.close(); }; }, []);
  const search = async () => {
    const value = query.trim();
    if (value.length < 2 || searching) return;
    setSearching(true); setError(null); setResults([]);
    try {
      const response = await fetch(`/api/geocoding/search?q=${encodeURIComponent(value)}`);
      const payload = await response.json() as { results?: GeocodingResult[] };
      if (!response.ok || !Array.isArray(payload.results)) throw new Error("geocoding");
      setResults(payload.results);
      if (payload.results.length === 0) setError("Aucun lieu trouvé. Précisez la recherche.");
    } catch { setError("La recherche de lieu est indisponible."); }
    finally { setSearching(false); }
  };

  return <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-24px)] w-[min(92vw,430px)] overflow-y-auto rounded-[24px] border border-[var(--bc-border)] bg-[var(--bc-background-elevated)] p-4 text-[var(--bc-text-primary)] shadow-[var(--bc-shadow-high)] backdrop:bg-[rgb(3_10_19_/_78%)]" aria-labelledby="favorite-weather-place-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <div className="flex items-center justify-between"><h2 id="favorite-weather-place-title" className="text-lg font-semibold">Ajouter un lieu météo</h2><button type="button" onClick={onCancel} className="grid min-h-11 min-w-11 place-items-center" aria-label="Fermer"><X size={20} /></button></div>
    <div className="mt-3 flex gap-2"><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--bc-border)] bg-transparent px-3 text-base" placeholder="Boeschepe, Bailleul, Bondues…" aria-label="Rechercher un lieu météo" /><button type="button" onClick={() => void search()} disabled={query.trim().length < 2 || searching} className="grid min-h-12 min-w-12 place-items-center rounded-xl border border-[var(--bc-border)] disabled:opacity-40" aria-label="Rechercher"><Search size={18} /></button></div>
    <p className="mt-2 text-xs text-[var(--bc-text-muted)]">{searching ? "Recherche…" : error ?? "Recherchez une ville, une commune ou un terrain."}</p>
    <div className="mt-2 grid gap-1">{results.map((place) => <button key={place.id} type="button" onClick={() => onSelect(place)} className="min-h-12 rounded-xl px-3 text-left text-sm font-semibold">{place.name}</button>)}</div>
    <div style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }} />
  </dialog>;
}
