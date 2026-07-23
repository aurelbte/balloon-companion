export interface GeographicBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface AirspaceTile {
  tileId: string;
  bounds: GeographicBounds;
  center: { latitude: number; longitude: number };
  requestRadiusMeters: number;
}

export const AIRSPACE_TILE_DEGREES = 0.5;
export const AIRSPACE_TILE_REQUEST_RADIUS_METERS = 45_000;
export const FRANCE_MAINLAND_BOUNDS: GeographicBounds = {
  west: -5.3,
  south: 42.2,
  east: 8.3,
  north: 51.2,
};
export const CORSICA_BOUNDS: GeographicBounds = {
  west: 8.5,
  south: 41.3,
  east: 9.7,
  north: 43.1,
};

function tileIndex(value: number): number {
  return Math.floor(value / AIRSPACE_TILE_DEGREES);
}

function tileFromIndexes(latitudeIndex: number, longitudeIndex: number): AirspaceTile {
  const south = latitudeIndex * AIRSPACE_TILE_DEGREES;
  const west = longitudeIndex * AIRSPACE_TILE_DEGREES;
  return {
    tileId: `fr-v1:${latitudeIndex}:${longitudeIndex}`,
    bounds: {
      west,
      south,
      east: west + AIRSPACE_TILE_DEGREES,
      north: south + AIRSPACE_TILE_DEGREES,
    },
    center: {
      latitude: south + AIRSPACE_TILE_DEGREES / 2,
      longitude: west + AIRSPACE_TILE_DEGREES / 2,
    },
    requestRadiusMeters: AIRSPACE_TILE_REQUEST_RADIUS_METERS,
  };
}

export function getAirspaceTileForPosition(
  latitude: number,
  longitude: number,
): AirspaceTile {
  return tileFromIndexes(tileIndex(latitude), tileIndex(longitude));
}

export function getAirspaceTileById(tileId: string): AirspaceTile | null {
  const [prefix, latitude, longitude] = tileId.split(":");
  const latitudeIndex = Number(latitude);
  const longitudeIndex = Number(longitude);
  if (
    prefix !== "fr-v1" ||
    !Number.isInteger(latitudeIndex) ||
    !Number.isInteger(longitudeIndex)
  ) {
    return null;
  }
  return tileFromIndexes(latitudeIndex, longitudeIndex);
}

export function getAirspaceTilesForBounds(
  bounds: GeographicBounds,
  marginDegrees = 0,
): AirspaceTile[] {
  const southIndex = tileIndex(bounds.south - marginDegrees);
  const northIndex = tileIndex(bounds.north + marginDegrees - Number.EPSILON);
  const westIndex = tileIndex(bounds.west - marginDegrees);
  const eastIndex = tileIndex(bounds.east + marginDegrees - Number.EPSILON);
  const tiles = new Map<string, AirspaceTile>();

  for (let latitudeIndex = southIndex; latitudeIndex <= northIndex; latitudeIndex += 1) {
    for (let longitudeIndex = westIndex; longitudeIndex <= eastIndex; longitudeIndex += 1) {
      const tile = tileFromIndexes(latitudeIndex, longitudeIndex);
      tiles.set(tile.tileId, tile);
    }
  }
  return [...tiles.values()].sort((left, right) =>
    left.tileId.localeCompare(right.tileId),
  );
}

export function getNeighboringAirspaceTiles(
  tile: AirspaceTile,
  ring = 1,
): AirspaceTile[] {
  const [, latitude, longitude] = tile.tileId.split(":");
  const latitudeIndex = Number(latitude);
  const longitudeIndex = Number(longitude);
  const tiles: AirspaceTile[] = [];
  for (let latitudeOffset = -ring; latitudeOffset <= ring; latitudeOffset += 1) {
    for (let longitudeOffset = -ring; longitudeOffset <= ring; longitudeOffset += 1) {
      tiles.push(
        tileFromIndexes(
          latitudeIndex + latitudeOffset,
          longitudeIndex + longitudeOffset,
        ),
      );
    }
  }
  return tiles.sort((left, right) => left.tileId.localeCompare(right.tileId));
}

export function getFranceAirspaceTiles(): AirspaceTile[] {
  const tiles = new Map<string, AirspaceTile>();
  for (const bounds of [FRANCE_MAINLAND_BOUNDS, CORSICA_BOUNDS]) {
    for (const tile of getAirspaceTilesForBounds(bounds)) {
      tiles.set(tile.tileId, tile);
    }
  }
  return [...tiles.values()].sort((left, right) =>
    left.tileId.localeCompare(right.tileId),
  );
}

export function estimateNationalAirspaceDownload(
  averageTileBytes = 250_000,
): { tileCount: number; estimatedBytes: number } {
  const tileCount = getFranceAirspaceTiles().length;
  return { tileCount, estimatedBytes: tileCount * averageTileBytes };
}
