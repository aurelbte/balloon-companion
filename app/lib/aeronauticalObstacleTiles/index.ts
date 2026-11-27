/** Client-safe public entry point. No maps, React, Node, electrical runtime or persistence. */
export { AeronauticalObstacleTileRuntime, ObstacleTileView } from "./runtime.ts";
export type { RuntimeOptions, ObstacleSnapshot, TileState } from "./runtime.ts";
export { parseObstacleManifest, parseObstacleTile, ObstacleTileError, OBSTACLE_SAFETY_WARNING } from "./contract.ts";
export type { ObstacleManifest, TileEntry, TileData, TileFeature, ErrorCode } from "./contract.ts";
export { selectObstacleTiles } from "./viewport.ts";
export type { Viewport, Selection } from "./viewport.ts";
