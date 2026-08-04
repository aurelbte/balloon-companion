"use client";

import { Check, LocateFixed, Map, MapPin, Search, Star } from "lucide-react";
import { sameLaunchSite, type FavoriteLaunchSite } from "../../lib/favoriteLaunchSites";
import type { GeocodingResult } from "../../lib/trajectory/integration";

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
  onToggleFavorite: (terrain: GeocodingResult) => void;
  /** Point d'extension pour les futurs terrains favoris du compte. */
  favoriteTerrains?: readonly FavoriteLaunchSite[];
  /** Point d'extension pour la future sélection précise sur carte. */
  onRequestMapSelection?: () => void;
};

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
  onToggleFavorite,
  favoriteTerrains = [],
  onRequestMapSelection,
}: TerrainSelectorProps) {
  return (
    <div className="relative mb-2">
      <div className="flex gap-2">
        <label
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl border px-3"
          style={{
            background: "rgb(255 255 255 / 3%)",
            borderColor: "var(--bc-border)",
          }}
        >
          <MapPin size={19} style={{ color: "var(--bc-accent)" }} />
          <span className="min-w-0 flex-1">
            <span
              className="block text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{ color: "var(--bc-color-text-muted)" }}
            >
              Terrain
            </span>
            <input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch();
              }}
              className="mt-0.5 w-full truncate border-0 bg-transparent p-0 text-base font-semibold outline-none"
              placeholder="Rechercher un terrain"
              aria-label="Rechercher un terrain"
            />
          </span>
        </label>
        <button
          type="button"
          onClick={onSearch}
          disabled={searching}
          className="flex h-12 w-11 shrink-0 items-center justify-center rounded-2xl border"
          style={{ borderColor: "var(--bc-border)" }}
          aria-label="Rechercher le terrain"
        >
          <Search size={18} />
        </button>
        <button
          type="button"
          onClick={onLocate}
          disabled={locating}
          className="flex h-12 w-11 shrink-0 items-center justify-center rounded-2xl border"
          style={{ borderColor: "var(--bc-border)" }}
          aria-label="Utiliser ma position"
        >
          {hasSelectedTerrain ? (
            <Check size={19} style={{ color: "var(--bc-success)" }} />
          ) : (
            <LocateFixed size={19} />
          )}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-56 overflow-y-auto rounded-2xl border p-2 shadow-2xl"
          style={{
            background: "var(--bc-background-elevated)",
            borderColor: "var(--bc-border)",
          }}
        >
          {suggestions.map((suggestion) => {
            const favorite = favoriteTerrains.some((item) => sameLaunchSite(item, suggestion));
            return <div key={suggestion.id} className="flex items-center rounded-xl">
              <button type="button" onClick={() => onSelectSuggestion(suggestion)} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 text-left text-sm font-semibold"><MapPin size={16} className="shrink-0" /><span className="line-clamp-2">{suggestion.name}</span></button>
              <button type="button" onClick={() => onToggleFavorite(suggestion)} className="grid min-h-11 min-w-11 place-items-center" aria-label={favorite ? `Retirer ${suggestion.name} des favoris` : `Ajouter ${suggestion.name} aux favoris`}><Star size={17} fill={favorite ? "currentColor" : "none"} style={{ color: "var(--bc-warning)" }} /></button>
            </div>;
          })}
          <p
            className="px-3 py-1 text-[10px]"
            style={{ color: "var(--bc-color-text-muted)" }}
          >
            © OpenStreetMap contributors
          </p>
        </div>
      )}

      {favoriteTerrains.length > 0 && (
        <div className="mt-2">
          <p
            className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: "var(--bc-color-text-muted)" }}
          >
            Favoris
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {favoriteTerrains.map((terrain) => {
              const selected = sameLaunchSite(selectedTerrain, terrain);
              return <div key={terrain.id} className="flex min-h-11 items-stretch rounded-xl border" style={{ background: selected ? "color-mix(in srgb, var(--bc-accent) 12%, var(--bc-surface))" : "rgb(255 255 255 / 3%)", borderColor: selected ? "var(--bc-accent)" : "var(--bc-border)" }}>
                <button type="button" aria-pressed={selected} onClick={() => onSelectFavorite(terrain)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left text-xs font-semibold"><Star size={14} fill="currentColor" style={{ color: "var(--bc-warning)" }} /><span className="min-w-0 flex-1 truncate">{terrain.name}</span>{selected && <span className="flex items-center gap-1 text-[9px]" style={{ color: "var(--bc-accent)" }}><Check size={13} /> Sélectionné</span>}</button>
                <button type="button" onClick={() => onToggleFavorite(terrain)} className="grid min-w-11 place-items-center border-l" style={{ borderColor: "var(--bc-border)" }} aria-label={`Retirer ${terrain.name} des favoris`}><Star size={15} fill="currentColor" style={{ color: "var(--bc-warning)" }} /></button>
              </div>;
            })}
          </div>
        </div>
      )}

      {selectedTerrain && <button type="button" onClick={() => onToggleFavorite(selectedTerrain)} className="mt-1 flex min-h-11 items-center gap-2 text-xs font-semibold" style={{ color: "var(--bc-accent)" }}><Star size={15} fill={favoriteTerrains.some((item) => sameLaunchSite(item, selectedTerrain)) ? "currentColor" : "none"} />{favoriteTerrains.some((item) => sameLaunchSite(item, selectedTerrain)) ? "Retirer des favoris" : "Ajouter aux favoris"}</button>}

      {onRequestMapSelection && (
        <button
          type="button"
          onClick={onRequestMapSelection}
          disabled={!hasSelectedTerrain}
          className="mt-1 flex min-h-11 items-center gap-2 text-xs font-semibold disabled:opacity-40"
          style={{ color: "var(--bc-accent)" }}
        >
          <Map size={15} /> Préciser le point sur la carte
        </button>
      )}
    </div>
  );
}
