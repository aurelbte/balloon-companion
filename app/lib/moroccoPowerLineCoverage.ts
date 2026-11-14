import footprint from "./data/moroccoPowerLinesCoverage.json" with { type: "json" };
import { powerLineFootprintCoverage, type TileCoverage } from "./belgiumPowerLineCoverage.ts";
import type { PowerLineBounds } from "./powerLines.ts";
/** Geofabrik extraction footprint; does not assert an official administrative boundary. */
export function moroccoPowerLineCoverage(view: PowerLineBounds): TileCoverage {
  return powerLineFootprintCoverage(view, footprint.geometry.coordinates);
}
