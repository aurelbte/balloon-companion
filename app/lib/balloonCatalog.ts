export type BalloonCatalogModel = { model: string; volumeM3: number };
export type BalloonCatalogManufacturer = { manufacturer: string; models: readonly BalloonCatalogModel[] };
export const BALLOON_CATALOG: readonly BalloonCatalogManufacturer[] = [{ manufacturer: "Cameron", models: [{ model: "Z105", volumeM3: 2_973 }, { model: "Z150", volumeM3: 4_247 }, { model: "Z350", volumeM3: 9_911 }] }] as const;
export function catalogManufacturers(): readonly string[] { return BALLOON_CATALOG.map(({ manufacturer }) => manufacturer); }
export function catalogModels(manufacturer: string): readonly BalloonCatalogModel[] { return BALLOON_CATALOG.find((item) => item.manufacturer === manufacturer)?.models ?? []; }
export function catalogVolume(manufacturer: string, model: string): number | null { return catalogModels(manufacturer).find((item) => item.model === model)?.volumeM3 ?? null; }
