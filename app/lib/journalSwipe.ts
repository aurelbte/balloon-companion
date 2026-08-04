export const JOURNAL_SWIPE_ACTIONS_WIDTH_PX = 152;
export const JOURNAL_SWIPE_AXIS_THRESHOLD_PX = 8;
export const JOURNAL_SWIPE_OPEN_DISTANCE_PX = 52;
export const JOURNAL_SWIPE_CLOSE_DISTANCE_PX = 38;
export const JOURNAL_SWIPE_FAST_VELOCITY_PX_PER_MS = 0.45;

export type JournalSwipeAxis = "horizontal" | "vertical" | null;
export type JournalSwipeStableState = "closed" | "open";
export type JournalSwipeState = JournalSwipeStableState | "dragging" | "settling";

export function journalSwipeAxis(deltaX: number, deltaY: number): JournalSwipeAxis {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < JOURNAL_SWIPE_AXIS_THRESHOLD_PX) return null;
  return Math.abs(deltaX) > Math.abs(deltaY) * 1.2 ? "horizontal" : "vertical";
}

export function journalSwipeInitialOffset(state: JournalSwipeStableState): number {
  return state === "open" ? -JOURNAL_SWIPE_ACTIONS_WIDTH_PX : 0;
}

export function journalSwipeOffset(deltaX: number, initialOffsetX: number): number {
  return Math.max(
    -JOURNAL_SWIPE_ACTIONS_WIDTH_PX,
    Math.min(0, initialOffsetX + deltaX),
  );
}

export function journalSwipeDestination({
  initialState,
  deltaX,
  velocityX,
  cancelled = false,
}: {
  initialState: JournalSwipeStableState;
  deltaX: number;
  velocityX: number;
  cancelled?: boolean;
}): JournalSwipeStableState {
  if (cancelled) return initialState;
  if (initialState === "closed") {
    return deltaX <= -JOURNAL_SWIPE_OPEN_DISTANCE_PX ||
      velocityX <= -JOURNAL_SWIPE_FAST_VELOCITY_PX_PER_MS
      ? "open"
      : "closed";
  }
  return deltaX >= JOURNAL_SWIPE_CLOSE_DISTANCE_PX ||
    velocityX >= JOURNAL_SWIPE_FAST_VELOCITY_PX_PER_MS
    ? "closed"
    : "open";
}
