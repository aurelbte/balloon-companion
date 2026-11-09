import { resolveBalloonForFlight, type Balloon } from "./balloons.ts";
import type { StoredFlightPreparationV2 } from "./flightStorage.ts";

/** Undefined means a proposal from the active preference; empty string is an explicit opt-out. */
export function resolvePreparationBalloon(balloons: readonly Balloon[], explicitId: string | undefined, activeBalloonId: string | null): Balloon | null {
  if (explicitId !== undefined && !balloons.some(({ id }) => id === explicitId)) return null;
  return resolveBalloonForFlight(balloons, explicitId, activeBalloonId);
}

/** Autosave keeps a proposal implicit; submitting a flight can capture the resolved selection. */
export function withPreparationBalloonChoice(snapshot: StoredFlightPreparationV2, explicitId: string | undefined): StoredFlightPreparationV2 {
  const next = { ...snapshot };
  if (explicitId === undefined) delete next.balloonName;
  else next.balloonName = explicitId;
  return next;
}
