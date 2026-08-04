export const JOURNAL_SWIPE_ACTIONS_WIDTH_PX = 152;
export const JOURNAL_SWIPE_OPEN_THRESHOLD_PX = 58;
export const JOURNAL_SWIPE_AXIS_THRESHOLD_PX = 8;

export type JournalSwipeAxis = "horizontal" | "vertical" | null;

export function journalSwipeAxis(deltaX: number, deltaY: number): JournalSwipeAxis {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < JOURNAL_SWIPE_AXIS_THRESHOLD_PX) return null;
  return Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
}

export function journalSwipeOffset(deltaX: number, initiallyOpen: boolean): number {
  const origin = initiallyOpen ? -JOURNAL_SWIPE_ACTIONS_WIDTH_PX : 0;
  return Math.max(-JOURNAL_SWIPE_ACTIONS_WIDTH_PX, Math.min(0, origin + deltaX));
}

export function shouldOpenJournalSwipe(offset: number): boolean {
  return Math.abs(offset) >= JOURNAL_SWIPE_OPEN_THRESHOLD_PX;
}
