import type { GeoPoint } from "../types/flight.ts";
import type { ExportedPlannedTrajectory } from "./trajectory/weatherAnalysisStorage.ts";

export const FLIGHT_WIND_ALTITUDE_LEVELS = [
  0, 100, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 2500, 3000,
] as const;

export type FlightWindLevel = (typeof FLIGHT_WIND_ALTITUDE_LEVELS)[number];

export interface ObservedWind {
  directionDeg: number;
  speedKt: number;
  sampleCount: number;
}

export function closestFlightWindLevel(altitudeM: number): FlightWindLevel {
  return FLIGHT_WIND_ALTITUDE_LEVELS.reduce((closest, level) =>
    Math.abs(level - altitudeM) < Math.abs(closest - altitudeM) ? level : closest,
  );
}

export function aggregateObservedWind(points: readonly GeoPoint[]): Map<FlightWindLevel, ObservedWind> {
  const samples = new Map<FlightWindLevel, GeoPoint[]>();
  for (const point of points) {
    if (point.altitude === null || point.speed === null || point.heading === null ||
        !Number.isFinite(point.altitude) || !Number.isFinite(point.speed) ||
        !Number.isFinite(point.heading) || point.speed < 0) continue;
    const level = closestFlightWindLevel(point.altitude);
    samples.set(level, [...(samples.get(level) ?? []), point]);
  }

  const profile = new Map<FlightWindLevel, ObservedWind>();
  for (const [level, levelSamples] of samples) {
    if (levelSamples.length < 3) continue;
    const directionRadians = levelSamples.map(({ heading }) => heading! * Math.PI / 180);
    const directionDeg = (Math.atan2(
      directionRadians.reduce((sum, angle) => sum + Math.sin(angle), 0),
      directionRadians.reduce((sum, angle) => sum + Math.cos(angle), 0),
    ) * 180 / Math.PI + 360) % 360;
    profile.set(level, {
      directionDeg,
      speedKt: levelSamples.reduce((sum, { speed }) => sum + speed!, 0) / levelSamples.length * 1.943844,
      sampleCount: levelSamples.length,
    });
  }
  return profile;
}

export function formatObservedWind(value: ObservedWind | undefined): string {
  return value ? `${String(Math.round(value.directionDeg) % 360).padStart(3, "0")}° / ${Math.round(value.speedKt)} kt` : "—";
}

export function predictedWindProfile(
  trajectories: readonly ExportedPlannedTrajectory[],
  providerModelId: string | null,
): Map<FlightWindLevel, ObservedWind> {
  const profile = new Map<FlightWindLevel, ObservedWind>();
  if (!providerModelId) return profile;
  for (const trajectory of trajectories) {
    if (trajectory.providerModelId !== providerModelId) continue;
    for (const wind of trajectory.predictedWindProfile ?? []) {
      profile.set(closestFlightWindLevel(wind.levelM), {
        directionDeg: wind.directionFromDeg,
        speedKt: wind.speedMps * 1.943844,
        sampleCount: 1,
      });
    }
    if (trajectory.predictedWind && !trajectory.predictedWindProfile?.length) {
      profile.set(closestFlightWindLevel(trajectory.altitudeAmslM), {
        directionDeg: trajectory.predictedWind.directionFromDeg,
        speedKt: trajectory.predictedWind.speedMps * 1.943844,
        sampleCount: 1,
      });
    }
  }
  return profile;
}
