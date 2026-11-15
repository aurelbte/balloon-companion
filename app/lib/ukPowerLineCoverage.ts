import footprint from "./data/ukPowerLinesCoverage.json" with { type: "json" };
import { powerLineFootprintCoverage, type TileCoverage } from "./belgiumPowerLineCoverage.ts";
import type { PowerLineBounds } from "./powerLines.ts";
/** Geofabrik extraction footprint; does not assert an official administrative boundary. */
export function ukPowerLineCoverage(view: PowerLineBounds): TileCoverage {
  return powerLineFootprintCoverage(view, footprint.geometry.coordinates);
}
