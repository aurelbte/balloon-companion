import type { GeocodingResult } from "./trajectory/integration.ts";

export const FAVORITE_LAUNCH_SITES_STORAGE_KEY = "balloon-companion-favorite-launch-sites-v1";
export const FAVORITE_LAUNCH_SITES_VERSION = 1 as const;

export type FavoriteLaunchSite = GeocodingResult & {
  icaoCode?: string;
  altitudeAmslM?: number;
  addedAt: string;
};

export const DEFAULT_FAVORITE_LAUNCH_SITES: readonly FavoriteLaunchSite[] = [
  { id: "favorite-lfqo", name: "LFQO", latitude: 50.686341, longitude: 3.079865, icaoCode: "LFQO", addedAt: "2026-01-01T00:00:00.000Z" },
  { id: "favorite-boeschepe", name: "Boeschepe", latitude: 50.80135, longitude: 2.687643, addedAt: "2026-01-01T00:00:00.000Z" },
];

function coordinateKey(site: Pick<GeocodingResult, "latitude" | "longitude">): string {
  return `${site.latitude.toFixed(6)}:${site.longitude.toFixed(6)}`;
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
): FavoriteLaunchSite[] {
  if (favorites.some((favorite) => sameLaunchSite(favorite, site))) return [...favorites];
  return [...favorites, { ...site, id: site.id.trim() || `launch-${coordinateKey(site)}`, addedAt }];
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
    window.localStorage.setItem(FAVORITE_LAUNCH_SITES_STORAGE_KEY, JSON.stringify({ version: FAVORITE_LAUNCH_SITES_VERSION, favorites }));
    return true;
  } catch {
    return false;
  }
}

export function loadFavoriteLaunchSites(): FavoriteLaunchSite[] {
  if (typeof window === "undefined") return [...DEFAULT_FAVORITE_LAUNCH_SITES];
  try {
    const raw = window.localStorage.getItem(FAVORITE_LAUNCH_SITES_STORAGE_KEY);
    if (!raw) return [...DEFAULT_FAVORITE_LAUNCH_SITES];
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== FAVORITE_LAUNCH_SITES_VERSION || !Array.isArray((value as { favorites?: unknown }).favorites)) return [...DEFAULT_FAVORITE_LAUNCH_SITES];
    return (value as { favorites: FavoriteLaunchSite[] }).favorites.filter((site) =>
      typeof site.id === "string" && Boolean(site.id.trim()) && typeof site.name === "string" && Boolean(site.name.trim()) &&
      Number.isFinite(site.latitude) && site.latitude >= -90 && site.latitude <= 90 &&
      Number.isFinite(site.longitude) && site.longitude >= -180 && site.longitude <= 180 &&
      typeof site.addedAt === "string" && Number.isFinite(Date.parse(site.addedAt)),
    ).reduce<FavoriteLaunchSite[]>((unique, site) => addFavoriteLaunchSite(unique, site, site.addedAt), []);
  } catch {
    return [...DEFAULT_FAVORITE_LAUNCH_SITES];
  }
}
