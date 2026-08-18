import type { GeocodingResult } from "./trajectory/integration.ts";
import { readScopedBusinessValue, writeScopedBusinessValue } from "./auth/dataScopeRuntime.ts";
import { enqueueLocalSyncMutation } from "./syncOutbox.ts";

export const FAVORITE_LAUNCH_SITES_STORAGE_KEY = "balloon-companion-favorite-launch-sites-v1";
export const FAVORITE_LAUNCH_SITES_VERSION = 1 as const;
export const FAVORITE_LAUNCH_SITES_EVENT = "balloon-companion:favorite-launch-sites-changed";

export type FavoriteLaunchSite = GeocodingResult & {
  /** Identité interne future ; absente des données historiques et jamais régénérée à la lecture. */
  syncId?: string;
  icaoCode?: string;
  altitudeAmslM?: number;
  /** Libellé technique d'origine, indépendant du nom personnalisé. */
  sourceName?: string;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_FAVORITE_LAUNCH_SITES: readonly FavoriteLaunchSite[] = [
  { id: "favorite-lfqo", name: "LFQO", latitude: 50.686341, longitude: 3.079865, icaoCode: "LFQO", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "favorite-boeschepe", name: "Boeschepe", latitude: 50.80135, longitude: 2.687643, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
];

function coordinateKey(site: Pick<GeocodingResult, "latitude" | "longitude">): string {
  return `${site.latitude.toFixed(6)}:${site.longitude.toFixed(6)}`;
}

function createInternalFavoriteId(): string | undefined {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : undefined;
}

export function sameLaunchSite(
  left: Pick<GeocodingResult, "id" | "latitude" | "longitude"> | null,
  right: Pick<GeocodingResult, "id" | "latitude" | "longitude"> | null,
): boolean {
  return Boolean(left && right && (left.id === right.id || coordinateKey(left) === coordinateKey(right)));
}

export function addFavoriteLaunchSite(
  favorites: readonly FavoriteLaunchSite[],
  site: GeocodingResult,
  addedAt = new Date().toISOString(),
  displayName = proposeFavoriteDisplayName(site),
): FavoriteLaunchSite[] {
  if (favorites.some((favorite) => sameLaunchSite(favorite, site))) return [...favorites];
  const syncId = createInternalFavoriteId();
  return [...favorites, {
    ...site,
    id: site.id.trim() || `launch-${coordinateKey(site)}`,
    ...(syncId ? { syncId } : {}),
    name: displayName.trim() || "Nouveau terrain",
    sourceName: site.name,
    createdAt: addedAt,
    updatedAt: addedAt,
  }];
}

export function addOrReuseFavoriteLaunchSite(
  favorites: readonly FavoriteLaunchSite[],
  site: GeocodingResult,
  addedAt = new Date().toISOString(),
): { favorites: FavoriteLaunchSite[]; selected: FavoriteLaunchSite } {
  const existing = favorites.find((favorite) => sameLaunchSite(favorite, site));
  if (existing) return { favorites: [...favorites], selected: existing };
  const next = addFavoriteLaunchSite(favorites, site, addedAt);
  return { favorites: next, selected: next.at(-1)! };
}

export function proposeFavoriteDisplayName(site: GeocodingResult): string {
  const icao = "icaoCode" in site && typeof site.icaoCode === "string"
    ? site.icaoCode.trim().toUpperCase()
    : "";
  if (/^[A-Z]{4}$/.test(icao)) return icao;
  const firstPart = site.name.split(",")[0]?.trim() ?? "";
  return firstPart.slice(0, 40) || "Nouveau terrain";
}

export function renameFavoriteLaunchSite(
  favorites: readonly FavoriteLaunchSite[],
  favoriteId: string,
  displayName: string,
): FavoriteLaunchSite[] {
  const normalizedName = displayName.trim();
  if (!normalizedName) return [...favorites];
  return favorites.map((favorite) =>
    favorite.id === favoriteId ? { ...favorite, name: normalizedName, updatedAt: new Date().toISOString() } : favorite,
  );
}

export function updateFavoriteLaunchSite(
  favorites: readonly FavoriteLaunchSite[],
  favoriteId: string,
  update: { name: string; latitude: number; longitude: number; sourceName?: string },
  updatedAt = new Date().toISOString(),
): { favorites: FavoriteLaunchSite[]; duplicate: FavoriteLaunchSite | null } {
  const existing = favorites.find((favorite) => favorite.id === favoriteId);
  if (!existing) return { favorites: [...favorites], duplicate: null };
  const duplicate = favorites.find((favorite) =>
    favorite.id !== favoriteId && coordinateKey(favorite) === coordinateKey(update),
  ) ?? null;
  if (duplicate) return { favorites: [...favorites], duplicate };
  const coordinatesChanged = coordinateKey(existing) !== coordinateKey(update);
  return {
    duplicate: null,
    favorites: favorites.map((favorite) => favorite.id === favoriteId ? {
      ...favorite,
      name: update.name.trim() || favorite.name,
      latitude: update.latitude,
      longitude: update.longitude,
      ...(update.sourceName ? { sourceName: update.sourceName } : {}),
      ...(coordinatesChanged ? { altitudeAmslM: undefined } : {}),
      updatedAt,
    } : favorite),
  };
}

export function removeFavoriteLaunchSite(
  favorites: readonly FavoriteLaunchSite[],
  site: GeocodingResult,
): FavoriteLaunchSite[] {
  return favorites.filter((favorite) => !sameLaunchSite(favorite, site));
}

export function saveFavoriteLaunchSites(favorites: readonly FavoriteLaunchSite[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = writeScopedBusinessValue(window.localStorage, FAVORITE_LAUNCH_SITES_STORAGE_KEY, JSON.stringify({ version: FAVORITE_LAUNCH_SITES_VERSION, favorites }));
    if (!saved) return false;
    enqueueLocalSyncMutation("favorite-launch-sites", "singleton");
    window.dispatchEvent(new Event(FAVORITE_LAUNCH_SITES_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function loadFavoriteLaunchSites(): FavoriteLaunchSite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = readScopedBusinessValue(window.localStorage, FAVORITE_LAUNCH_SITES_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== FAVORITE_LAUNCH_SITES_VERSION || !Array.isArray((value as { favorites?: unknown }).favorites)) return [];
    return (value as { favorites: FavoriteLaunchSite[] }).favorites.filter((site) =>
      typeof site.id === "string" && Boolean(site.id.trim()) && typeof site.name === "string" && Boolean(site.name.trim()) &&
      Number.isFinite(site.latitude) && site.latitude >= -90 && site.latitude <= 90 &&
      Number.isFinite(site.longitude) && site.longitude >= -180 && site.longitude <= 180 &&
      ((typeof site.createdAt === "string" && Number.isFinite(Date.parse(site.createdAt))) ||
        (typeof (site as { addedAt?: unknown }).addedAt === "string" && Number.isFinite(Date.parse((site as unknown as { addedAt: string }).addedAt)))),
    ).reduce<FavoriteLaunchSite[]>((unique, site) => {
      const legacyAddedAt = (site as unknown as { addedAt?: string }).addedAt;
      const createdAt = typeof site.createdAt === "string" ? site.createdAt : legacyAddedAt ?? new Date().toISOString();
      const migrated = {
        ...site,
        sourceName: typeof site.sourceName === "string" && site.sourceName.trim()
          ? site.sourceName
          : site.name,
      };
      const next = addFavoriteLaunchSite(unique, migrated, createdAt, site.name);
      const current = next.at(-1);
      if (current) current.updatedAt = typeof site.updatedAt === "string" ? site.updatedAt : createdAt;
      return next;
    }, []);
  } catch {
    return [];
  }
}
