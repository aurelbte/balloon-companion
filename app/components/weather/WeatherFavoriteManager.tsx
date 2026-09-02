"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FavoriteWeatherPlace } from "../../lib/favoriteWeatherPlaces";
import type { GeocodingResult } from "../../lib/trajectory/integration";

type Mode = "list" | "add" | "edit";

export default function WeatherFavoriteManager({ favorites, onClose, onAdd, onRename, onRemove }: Readonly<{
  favorites: readonly FavoriteWeatherPlace[];
  onClose(): void;
  onAdd(place: GeocodingResult): void;
  onRename(id: string, name: string): void;
  onRemove(id: string): Promise<boolean>;
}>) {
  const [mode, setMode] = useState<Mode>("list");
  const [editing, setEditing] = useState<FavoriteWeatherPlace | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [selected, setSelected] = useState<GeocodingResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = query.trim();
    if (mode !== "add" || selected || value.length < 2) { setResults([]); setSearching(false); return; }
    let active = true;
    const controller = new AbortController();
    setSearching(true);
    const timeout = window.setTimeout(() => {
      fetch(`/api/geocoding/search?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as { results?: GeocodingResult[] };
          if (!response.ok) throw new Error("SEARCH_FAILED");
          return payload.results ?? [];
        })
        .then((items) => { if (active) setResults(items); })
        .catch((cause: unknown) => { if (active && !(cause instanceof DOMException && cause.name === "AbortError")) setError("La recherche de lieu est indisponible. Réessayez."); })
        .finally(() => { if (active) setSearching(false); });
    }, 350);
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [mode, query, selected]);

  const showList = () => { setMode("list"); setEditing(null); setSelected(null); setName(""); setQuery(""); setResults([]); setError(null); };

  return <div className="fixed inset-0 z-[150] flex items-end bg-black/55 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="weather-favorite-manager-title">
    <div className="max-h-[82dvh] w-full max-w-md overflow-y-auto rounded-[24px] border p-4 shadow-2xl" style={{ background: "var(--bc-background-elevated)", borderColor: "var(--bc-border)" }}>
      <div className="flex items-center justify-between">
        <h2 id="weather-favorite-manager-title" className="text-lg font-semibold">Gérer les favoris</h2>
        <button type="button" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center" aria-label="Fermer"><X size={20} /></button>
      </div>

      {mode === "list" && <>
        <button type="button" onClick={() => { setMode("add"); setError(null); }} className="mt-2 flex min-h-11 items-center gap-2 font-semibold" style={{ color: "var(--bc-accent)" }}><Plus size={18} /> Ajouter un favori</button>
        <div className="mt-2 grid gap-2">
          {favorites.map((favorite) => <div key={favorite.id} className="rounded-2xl border p-3" style={{ borderColor: "var(--bc-border)" }}>
            <p className="font-semibold">{favorite.name}</p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--bc-color-text-muted)" }}>{favorite.latitude.toFixed(5)}, {favorite.longitude.toFixed(5)}</p>
            <div className="mt-2 flex gap-4">
              <button type="button" onClick={() => { setEditing(favorite); setName(favorite.name); setMode("edit"); setError(null); }} className="flex min-h-10 items-center gap-1.5 text-xs font-semibold"><Pencil size={15} /> Modifier</button>
              <button type="button" onClick={async () => { if (!window.confirm(`Supprimer le favori « ${favorite.name} » ?`)) return; setError(null); if (!await onRemove(favorite.id)) setError("Suppression non enregistrée. Réessayez."); }} className="flex min-h-10 items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--bc-danger)" }}><Trash2 size={15} /> Supprimer</button>
            </div>
          </div>)}
          {favorites.length === 0 && <p className="py-3 text-sm" style={{ color: "var(--bc-color-text-muted)" }}>Aucun favori enregistré.</p>}
        </div>
        {error && <p className="mt-2 text-xs" role="alert" style={{ color: "var(--bc-danger)" }}>{error}</p>}
      </>}

      {mode === "add" && <div className="mt-3">
        {!selected ? <>
          <label className="text-xs font-semibold" htmlFor="weather-favorite-search">Rechercher un lieu</label>
          <input id="weather-favorite-search" type="search" enterKeyHint="search" autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setError(null); }} className="mt-1 min-h-11 w-full rounded-xl border bg-transparent px-3" style={{ borderColor: "var(--bc-border)" }} />
          <p className="mt-2 text-xs" style={{ color: "var(--bc-color-text-muted)" }}>{query.trim().length < 2 ? "Saisissez au moins deux caractères" : searching ? "Recherche…" : results.length === 0 ? "Aucun lieu trouvé" : "Sélectionnez un lieu"}</p>
          <div className="mt-2 grid gap-1">{results.map((place) => <button key={place.id} type="button" onClick={() => { setSelected(place); setName(place.name); setResults([]); }} className="min-h-11 rounded-xl px-2 text-left text-sm font-semibold">{place.name}</button>)}</div>
        </> : <>
          <label className="text-xs font-semibold" htmlFor="weather-favorite-add-name">Nom du favori</label>
          <input id="weather-favorite-add-name" autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border bg-transparent px-3" style={{ borderColor: "var(--bc-border)" }} />
          <p className="mt-2 text-xs" style={{ color: "var(--bc-color-text-muted)" }}>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</p>
          <button type="button" disabled={!name.trim()} onClick={() => { onAdd({ ...selected, name: name.trim() }); showList(); }} className="mt-3 min-h-11 w-full rounded-xl px-4 font-semibold disabled:opacity-40" style={{ background: "var(--bc-accent)", color: "white" }}>Enregistrer</button>
        </>}
        {error && <p className="mt-2 text-xs" role="alert" style={{ color: "var(--bc-danger)" }}>{error}</p>}
        <button type="button" onClick={showList} className="mt-2 min-h-10 text-xs font-semibold" style={{ color: "var(--bc-accent)" }}>Retour à la liste</button>
      </div>}

      {mode === "edit" && editing && <div className="mt-3">
        <label className="text-xs font-semibold" htmlFor="weather-favorite-edit-name">Nom du favori</label>
        <input id="weather-favorite-edit-name" autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border bg-transparent px-3" style={{ borderColor: "var(--bc-border)" }} />
        <p className="mt-2 text-xs" style={{ color: "var(--bc-color-text-muted)" }}>{editing.latitude.toFixed(5)}, {editing.longitude.toFixed(5)}</p>
        <button type="button" disabled={!name.trim()} onClick={() => { onRename(editing.id, name.trim()); showList(); }} className="mt-3 min-h-11 w-full rounded-xl px-4 font-semibold disabled:opacity-40" style={{ background: "var(--bc-accent)", color: "white" }}>Enregistrer</button>
        <button type="button" onClick={showList} className="mt-2 min-h-10 text-xs font-semibold" style={{ color: "var(--bc-accent)" }}>Retour à la liste</button>
      </div>}
    </div>
  </div>;
}
