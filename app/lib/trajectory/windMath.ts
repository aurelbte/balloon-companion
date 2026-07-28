import type { WindVector } from "./types.ts";

export type WindComponents = {
  eastMps: number;
  northMps: number;
};

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * Une direction météo indique d’où vient le vent.
 * Le déplacement de la masse d’air s’effectue dans la direction opposée.
 */
export function windDirectionFromToMovementDirection(
  directionFromDeg: number,
): number {
  return normalizeDegrees(directionFromDeg + 180);
}

export function windVectorToMovementComponents(
  wind: WindVector,
): WindComponents {
  const directionToRad =
    (windDirectionFromToMovementDirection(wind.directionFromDeg) * Math.PI) /
    180;
  return {
    eastMps: wind.speedMps * Math.sin(directionToRad),
    northMps: wind.speedMps * Math.cos(directionToRad),
  };
}

export function movementComponentsToWindVector(
  components: WindComponents,
): WindVector {
  const speedMps = Math.hypot(components.eastMps, components.northMps);
  if (speedMps < 1e-9) {
    return { speedMps: 0, directionFromDeg: 0 };
  }

  const directionToDeg = normalizeDegrees(
    (Math.atan2(components.eastMps, components.northMps) * 180) / Math.PI,
  );
  return {
    speedMps,
    directionFromDeg: normalizeDegrees(directionToDeg + 180),
  };
}

export function interpolateWindVectors(
  before: WindVector,
  after: WindVector,
  ratio: number,
): WindVector {
  const boundedRatio = Math.min(1, Math.max(0, ratio));
  const beforeComponents = windVectorToMovementComponents(before);
  const afterComponents = windVectorToMovementComponents(after);

  return movementComponentsToWindVector({
    eastMps:
      beforeComponents.eastMps +
      (afterComponents.eastMps - beforeComponents.eastMps) * boundedRatio,
    northMps:
      beforeComponents.northMps +
      (afterComponents.northMps - beforeComponents.northMps) * boundedRatio,
  });
}
