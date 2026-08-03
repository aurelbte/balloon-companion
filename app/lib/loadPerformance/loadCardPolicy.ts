import type { LoadUnavailableReasonCode } from "./types.ts";

const BALLOON_CORRECTION_REASONS = new Set([
  "MISSING_MTOW",
  "CONFIGURATION_LIMITS_UNCONFIRMED",
  "VOLUME_MISMATCH",
  "INCOMPLETE_BALLOON_MASSES",
]);

export function loadCardBalloonCorrectionPath(balloonId: string | undefined, result: Readonly<{ status: "AVAILABLE" } | { status: "UNAVAILABLE"; reasonCode: LoadUnavailableReasonCode }>): string | null {
  if (!balloonId || result.status !== "UNAVAILABLE" || !BALLOON_CORRECTION_REASONS.has(result.reasonCode)) return null;
  return `/more/profile/balloons/${encodeURIComponent(balloonId)}/edit`;
}
