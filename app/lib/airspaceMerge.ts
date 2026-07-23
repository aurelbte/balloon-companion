import type { AirspaceFeatureCollection } from "./openaip.ts";

export interface MergeableAirspaceTile {
  tileId: string;
  fetchedAt: number;
  airspaces: AirspaceFeatureCollection["features"];
}

export function mergeAirspacesById(
  tiles: MergeableAirspaceTile[],
  onConflict?: (airspaceId: string) => void,
): AirspaceFeatureCollection {
  const byId = new Map<
    string,
    { fetchedAt: number; feature: AirspaceFeatureCollection["features"][number] }
  >();
  const orderedTiles = [...tiles].sort(
    (left, right) =>
      left.fetchedAt - right.fetchedAt ||
      left.tileId.localeCompare(right.tileId),
  );

  for (const tile of orderedTiles) {
    for (const feature of tile.airspaces) {
      const id = feature.properties.airspaceId;
      const previous = byId.get(id);
      if (
        previous &&
        JSON.stringify(previous.feature) !== JSON.stringify(feature)
      ) {
        onConflict?.(id);
      }
      if (!previous || tile.fetchedAt >= previous.fetchedAt) {
        byId.set(id, { fetchedAt: tile.fetchedAt, feature });
      }
    }
  }

  return {
    type: "FeatureCollection",
    features: [...byId.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => entry.feature),
  };
}
