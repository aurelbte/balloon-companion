import { windDirectionFromToMovementDirection } from "../lib/trajectory/windMath.ts";

const NAVIGATION_ICON_NATIVE_BEARING_DEG = 45;

export function windArrowRotationDegrees(
  directionFromDeg: number | undefined,
): number {
  if (directionFromDeg === undefined || !Number.isFinite(directionFromDeg)) {
    return 0;
  }
  return (
    windDirectionFromToMovementDirection(directionFromDeg) -
    NAVIGATION_ICON_NATIVE_BEARING_DEG +
    360
  ) % 360;
}
