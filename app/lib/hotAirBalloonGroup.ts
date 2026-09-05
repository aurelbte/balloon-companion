export type HotAirBalloonGroup = "A" | "B" | "C" | "D";

export const HOT_AIR_BALLOON_GROUPS = Object.freeze(["A", "B", "C", "D"] as const satisfies readonly HotAirBalloonGroup[]);

/** Groupe physique du ballon uniquement ; ne qualifie jamais les privilèges du pilote. */
export function getHotAirBalloonGroup(volumeM3: number | null | undefined): HotAirBalloonGroup | null {
  if (typeof volumeM3 !== "number" || !Number.isFinite(volumeM3) || volumeM3 <= 0) return null;
  if (volumeM3 <= 3_400) return "A";
  if (volumeM3 <= 6_000) return "B";
  if (volumeM3 <= 10_500) return "C";
  return "D";
}
