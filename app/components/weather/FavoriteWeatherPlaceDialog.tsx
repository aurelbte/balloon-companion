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
  const [selectedPlace, setSelectedPlace] = useState<GeocodingResult | null>(null);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => { const dialog = dialogRef.current; if (!dialog) return; dialog.showModal(); inputRef.current?.focus(); return () => { if (dialog.open) dialog.close(); }; }, []);
  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) { setResults([]); setSearching(false); setError(null); return; }
    let active = true;
    const controller = new AbortController();
    setSearching(true); setError(null); setResults([]);
    const timeout = window.setTimeout(() => {
      fetch(`/api/geocoding/search?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        .then(async (response) => { const payload = await response.json() as { results?: GeocodingResult[] }; if (!response.ok || !Array.isArray(payload.results)) throw new Error("geocoding"); return payload.results; })
        .then((places) => { if (active) { setResults(places); setError(places.length === 0 ? "Aucun lieu trouvé. Précisez la recherche." : null); } })
        .catch((reason: unknown) => { if (active && !(reason instanceof DOMException && reason.name === "AbortError")) { setResults([]); setError("La recherche de lieu est indisponible."); } })
        .finally(() => { if (active) setSearching(false); });
    }, 350);
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [query]);

  return <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-24px)] w-[min(92vw,430px)] overflow-y-auto rounded-[24px] border border-[var(--bc-border)] bg-[var(--bc-background-elevated)] p-4 text-[var(--bc-text-primary)] shadow-[var(--bc-shadow-high)] backdrop:bg-[rgb(3_10_19_/_78%)]" aria-labelledby="favorite-weather-place-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <div className="flex items-center justify-between"><h2 id="favorite-weather-place-title" className="text-lg font-semibold">Ajouter un lieu météo</h2><button type="button" onClick={onCancel} className="grid min-h-11 min-w-11 place-items-center" aria-label="Fermer"><X size={20} /></button></div>
    <label className="mt-3 flex min-h-12 items-center gap-2 rounded-xl border border-[var(--bc-border)] px-3"><Search size={18} aria-hidden="true" className="shrink-0 text-[var(--bc-text-muted)]" /><input ref={inputRef} type="search" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base outline-none" placeholder="Boeschepe, Bailleul, Bondues…" aria-label="Rechercher un lieu météo" /></label>
    <p className="mt-2 text-xs text-[var(--bc-text-muted)]">{searching ? "Recherche…" : error ?? "Recherchez une ville, une commune ou un terrain."}</p>
    <div className="mt-2 grid gap-1">{results.map((place) => { const [name, ...context] = place.name.split(",").map((part) => part.trim()).filter(Boolean); return <button key={place.id} type="button" onClick={() => { setSelectedPlace(place); setDisplayName(name ?? place.name); }} className="min-h-14 rounded-xl px-3 py-2 text-left"><strong className="block text-sm">{name ?? place.name}</strong>{context.length > 0 && <span className="mt-0.5 block truncate text-xs text-[var(--bc-text-muted)]">{context.join(", ")}</span>}</button>; })}</div>
    {selectedPlace && <form className="mt-3 border-t border-[var(--bc-border)] pt-3" onSubmit={(event) => { event.preventDefault(); if (displayName.trim()) onSelect({ ...selectedPlace, name: displayName.trim() }); }}><label className="text-xs font-semibold" htmlFor="favorite-weather-name">Nom du favori</label><input id="favorite-weather-name" autoFocus required maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-[var(--bc-border)] bg-transparent px-3" /><button type="submit" className="mt-3 min-h-11 w-full rounded-full bg-[var(--bc-accent)] font-semibold text-[var(--bc-accent-foreground)]">Enregistrer</button></form>}
    <div style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }} />
  </dialog>;
}
