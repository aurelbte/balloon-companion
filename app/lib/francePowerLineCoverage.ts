import footprint from "./data/francePowerLinesCoverage.json" with { type: "json" };
import { powerLineFootprintCoverage, type TileCoverage } from "./belgiumPowerLineCoverage.ts";
import type { PowerLineBounds } from "./powerLines.ts";
export function francePowerLineCoverage(view: PowerLineBounds): TileCoverage {
  return powerLineFootprintCoverage(view, footprint.geometry.coordinates);
}
