"use client";

import { useState } from "react";
import { Check, LocateFixed, Map, MapPin, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  proposeFavoriteDisplayName,
  sameLaunchSite,
  type FavoriteLaunchSite,
} from "../../lib/favoriteLaunchSites";
import type { GeocodingResult } from "../../lib/trajectory/integration";
import LaunchPointMapDialog from "./LaunchPointMapDialog";

export type TerrainSelectorProps = {
  value: string;
  hasSelectedTerrain: boolean;
  suggestions: readonly GeocodingResult[];
  searching: boolean;
  locating: boolean;
  onValueChange: (value: string) => void;
  onSearch: () => void;
  onLocate: () => void;
  onSelectSuggestion: (terrain: GeocodingResult) => void;
  onSelectFavorite: (terrain: GeocodingResult) => void;
  selectedTerrain: GeocodingResult | null;
  onAddFavorite: (terrain: GeocodingResult, displayName: string) => string | null;
  onUpdateFavorite: (favoriteId: string, point: GeocodingResult, displayName: string) => string | null;
  onRemoveFavorite: (terrain: GeocodingResult) => void;
  favoriteTerrains?: readonly FavoriteLaunchSite[];
  onRequestMapSelection?: () => void;
};

type FavoriteEditor =
  | { mode: "closed" | "list" }
  | { mode: "add"; terrain: GeocodingResult | null; name: string }
  | { mode: "edit"; original: FavoriteLaunchSite; terrain: GeocodingResult; name: string };

export default function TerrainSelector({
  value,
  hasSelectedTerrain,
  suggestions,
  searching,
  locating,
  onValueChange,
  onSearch,
  onLocate,
  onSelectSuggestion,
  onSelectFavorite,
  selectedTerrain,
  onAddFavorite,
  onUpdateFavorite,
  onRemoveFavorite,
  favoriteTerrains = [],
  onRequestMapSelection,
}: TerrainSelectorProps) {
  const [editor, setEditor] = useState<FavoriteEditor>({ mode: "closed" });
  const [managerQuery, setManagerQuery] = useState("");
  const [managerResults, setManagerResults] = useState<GeocodingResult[]>([]);
  const [managerSearching, setManagerSearching] = useState(false);
  const [mapDraft, setMapDraft] = useState<{ point: GeocodingResult; favorite?: FavoriteLaunchSite } | null>(null);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [editSearchTarget, setEditSearchTarget] = useState<FavoriteLaunchSite | null>(null);
  const managerOpen = editor.mode !== "closed";
  const duplicateFavorite = editor.mode === "add" && editor.terrain
    ? favoriteTerrains.find((favorite) => sameLaunchSite(favorite, editor.terrain)) ?? null
    : null;

  const selectFavoriteCandidate = (terrain: GeocodingResult) => {
    setMapDraft({ point: terrain, ...(editSearchTarget ? { favorite: editSearchTarget } : {}) });
  };

  const searchFavoriteCandidate = async () => {
    const query = managerQuery.trim();
    if (query.length < 2 || managerSearching) return;
    setManagerSearching(true);
    setManagerResults([]);
    try {
      const response = await fetch(`/api/geocoding/search?q=${encodeURIComponent(query)}`);
      const payload: unknown = await response.json();
      if (response.ok && payload && typeof payload === "object" && Array.isArray((payload as { results?: unknown }).results)) {
        setManagerResults((payload as { results: GeocodingResult[] }).results);
      }
    } finally {
      setManagerSearching(false);
    }
  };

  return (
    <div className="relative mb-2">
      <div className="flex gap-2">
        <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl border px-3" style={{ background: "rgb(255 255 255 / 3%)", borderColor: "var(--bc-border)" }}>
          <MapPin size={19} style={{ color: "var(--bc-accent)" }} />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--bc-color-text-muted)" }}>Terrain</span>
            <input type="search" enterKeyHint="search" value={value} onChange={(event) => onValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch(); }} className="mt-0.5 w-full truncate border-0 bg-transparent p-0 text-base font-semibold outline-none" placeholder="Rechercher un terrain" aria-label="Rechercher un terrain" />
          </span>
        </label>
        <button type="button" onClick={onSearch} disabled={searching} className="flex h-12 w-11 shrink-0 items-center justify-center rounded-2xl border" style={{ borderColor: "var(--bc-border)" }} aria-label="Rechercher le terrain"><Search size={18} /></button>
        <button type="button" onClick={onLocate} disabled={locating} className="flex h-12 w-11 shrink-0 items-center justify-center rounded-2xl border" style={{ borderColor: "var(--bc-border)" }} aria-label="Utiliser ma position">{hasSelectedTerrain ? <Check size={19} style={{ color: "var(--bc-success)" }} /> : <LocateFixed size={19} />}</button>
      </div>

      {suggestions.length > 0 && !managerOpen && (
        <div className="absolute left-0 right-0 top-12 z-50 mt-2 max-h-56 overflow-y-auto rounded-2xl border p-2 shadow-2xl" style={{ background: "var(--bc-background-elevated)", borderColor: "var(--bc-border)" }}>
          {suggestions.map((suggestion) => (
            <button key={suggestion.id} type="button" onClick={() => onSelectSuggestion(suggestion)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold"><MapPin size={16} className="shrink-0" /><span className="line-clamp-2">{suggestion.name}</span></button>
          ))}
          <p className="px-3 py-1 text-[10px]" style={{ color: "var(--bc-color-text-muted)" }}>© OpenStreetMap contributors</p>
        </div>
      )}

      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--bc-color-text-muted)" }}>Favoris</p>
          <button type="button" onClick={() => setEditor({ mode: "list" })} className="min-h-9 px-1 text-xs font-semibold" style={{ color: "var(--bc-accent)" }}>Gérer</button>
        </div>
        {favoriteTerrains.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Terrains favoris">
            {favoriteTerrains.map((terrain) => {
              const selected = sameLaunchSite(selectedTerrain, terrain);
              return (
                <div key={terrain.id} role="option" aria-selected={selected} className="rounded-xl border" style={{ background: selected ? "color-mix(in srgb, var(--bc-accent) 12%, var(--bc-surface))" : "rgb(255 255 255 / 3%)", borderColor: selected ? "var(--bc-accent)" : "var(--bc-border)" }}>
                  <button type="button" onClick={() => onSelectFavorite(terrain)} className="flex min-h-10 items-center gap-1.5 px-2.5 text-xs font-semibold"><span>{terrain.name}</span>{selected && <Check size={14} style={{ color: "var(--bc-accent)" }} />}</button>
                </div>
              );
            })}
          </div>
        ) : <p className="text-xs" style={{ color: "var(--bc-color-text-muted)" }}>Aucun favori enregistré.</p>}
      </div>

      {onRequestMapSelection && <button type="button" onClick={onRequestMapSelection} disabled={!hasSelectedTerrain} className="mt-1 flex min-h-11 items-center gap-2 text-xs font-semibold disabled:opacity-40" style={{ color: "var(--bc-accent)" }}><Map size={15} /> Préciser le point sur la carte</button>}

      {managerOpen && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/55 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="favorite-manager-title">
          <div className="max-h-[82dvh] w-full max-w-md overflow-y-auto rounded-[24px] border p-4 shadow-2xl" style={{ background: "var(--bc-background-elevated)", borderColor: "var(--bc-border)" }}>
            <div className="flex items-center justify-between">
              <h2 id="favorite-manager-title" className="text-lg font-semibold">Gérer les favoris</h2>
              <button type="button" onClick={() => setEditor({ mode: "closed" })} className="grid min-h-11 min-w-11 place-items-center" aria-label="Fermer"><X size={20} /></button>
            </div>

            {editor.mode === "list" && (
              <>
                <button type="button" onClick={() => { setEditSearchTarget(null); setEditor({ mode: "add", terrain: null, name: "" }); }} className="mt-2 flex min-h-11 items-center gap-2 font-semibold" style={{ color: "var(--bc-accent)" }}><Plus size={18} /> Ajouter un favori</button>
                <div className="mt-2 grid gap-2">
                  {favoriteTerrains.map((terrain) => (
                    <div key={terrain.id} className="rounded-2xl border p-3" style={{ borderColor: "var(--bc-border)" }}>
                      <p className="font-semibold">{terrain.name}</p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--bc-color-text-muted)" }}>{terrain.latitude.toFixed(5)}, {terrain.longitude.toFixed(5)}</p>
                      <div className="mt-2 flex gap-4">
                        <button type="button" onClick={() => setMapDraft({ point: terrain, favorite: terrain })} className="flex min-h-10 items-center gap-1.5 text-xs font-semibold"><Pencil size={15} /> Modifier</button>
                        <button type="button" onClick={() => { if (window.confirm(`Supprimer le favori « ${terrain.name} » ?`)) onRemoveFavorite(terrain); }} className="flex min-h-10 items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--bc-danger)" }}><Trash2 size={15} /> Supprimer</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {editor.mode === "add" && (
              <div className="mt-3">
                {!editor.terrain ? (
                  <>
                    <label className="text-xs font-semibold">Rechercher un terrain</label>
                    <div className="mt-1 flex gap-2"><input type="search" enterKeyHint="search" value={managerQuery} onChange={(event) => setManagerQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchFavoriteCandidate(); }} className="min-h-11 min-w-0 flex-1 rounded-xl border bg-transparent px-3" style={{ borderColor: "var(--bc-border)" }} /><button type="button" onClick={() => void searchFavoriteCandidate()} disabled={managerSearching} className="grid min-h-11 min-w-11 place-items-center rounded-xl border" style={{ borderColor: "var(--bc-border)" }} aria-label="Rechercher"><Search size={17} /></button></div>
                    <div className="mt-2 grid gap-1">{managerResults.map((suggestion) => <button key={suggestion.id} type="button" onClick={() => selectFavoriteCandidate(suggestion)} className="min-h-11 rounded-xl px-2 text-left text-sm font-semibold">{suggestion.name}</button>)}</div>
                  </>
                ) : (
                  <>
                    <label className="text-xs font-semibold" htmlFor="favorite-name">Nom du favori</label>
                    <input id="favorite-name" autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={40} className="mt-1 min-h-11 w-full rounded-xl border bg-transparent px-3" style={{ borderColor: "var(--bc-border)" }} />
                    <p className="mt-2 text-xs" style={{ color: "var(--bc-color-text-muted)" }}>{editor.terrain.latitude.toFixed(5)}, {editor.terrain.longitude.toFixed(5)}</p>
                    {favoriteError && <><p className="mt-2 text-xs" style={{ color: "var(--bc-danger)" }}>{favoriteError}</p>{duplicateFavorite && <button type="button" onClick={() => { setFavoriteError(null); setMapDraft({ point: duplicateFavorite, favorite: duplicateFavorite }); }} className="mt-1 min-h-10 text-xs font-semibold" style={{ color: "var(--bc-accent)" }}>Modifier le favori existant</button>}</>}
                    <button type="button" disabled={!editor.name.trim()} onClick={() => { const error = onAddFavorite(editor.terrain!, editor.name); if (error) setFavoriteError(error); else { setFavoriteError(null); setEditor({ mode: "list" }); } }} className="mt-3 min-h-11 rounded-xl px-4 font-semibold disabled:opacity-40" style={{ background: "var(--bc-accent)", color: "white" }}>Enregistrer</button>
                  </>
                )}
              </div>
            )}

            {editor.mode === "edit" && (
              <div className="mt-3">
                <label className="text-xs font-semibold" htmlFor="favorite-rename">Nom du favori</label>
                <input id="favorite-rename" autoFocus value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={40} className="mt-1 min-h-11 w-full rounded-xl border bg-transparent px-3" style={{ borderColor: "var(--bc-border)" }} />
                <p className="mt-2 text-xs" style={{ color: "var(--bc-color-text-muted)" }}>{editor.terrain.latitude.toFixed(5)}, {editor.terrain.longitude.toFixed(5)}</p>
                {favoriteError && <p className="mt-2 text-xs" style={{ color: "var(--bc-danger)" }}>{favoriteError}</p>}
                <button type="button" onClick={() => { setEditSearchTarget(editor.original); setManagerQuery(""); setManagerResults([]); setEditor({ mode: "add", terrain: null, name: editor.name }); }} className="mt-2 min-h-10 text-xs font-semibold" style={{ color: "var(--bc-accent)" }}>Rechercher un autre lieu</button>
                <button type="button" disabled={!editor.name.trim()} onClick={() => { const error = onUpdateFavorite(editor.original.id, editor.terrain, editor.name); if (error) setFavoriteError(error); else { setFavoriteError(null); setEditor({ mode: "list" }); } }} className="mt-3 min-h-11 w-full rounded-xl px-4 font-semibold disabled:opacity-40" style={{ background: "var(--bc-accent)", color: "white" }}>Enregistrer</button>
              </div>
            )}
          </div>
        </div>
      )}

      {mapDraft && (
        <LaunchPointMapDialog
          initialPoint={mapDraft.point}
          title={mapDraft.favorite?.name ?? proposeFavoriteDisplayName(mapDraft.point)}
          instruction="Déplacez le point sur le lieu exact de décollage"
          confirmLabel="Utiliser ce point"
          onCancel={() => setMapDraft(null)}
          onConfirm={(point) => {
            if (mapDraft.favorite) {
              setEditor({ mode: "edit", original: mapDraft.favorite, terrain: point, name: mapDraft.favorite.name });
            } else {
              setEditor({ mode: "add", terrain: point, name: proposeFavoriteDisplayName(mapDraft.point) });
            }
            setMapDraft(null);
          }}
        />
      )}
    </div>
  );
}
